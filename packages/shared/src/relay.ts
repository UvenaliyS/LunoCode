/**
 * Relay wire protocol — extension ⇄ webapp-server ⇄ phone(s).
 *
 * One envelope, versioned. The payloads are the UNCHANGED ExtensionToWebview /
 * WebviewToExtension unions from index.ts — the relay never parses them beyond
 * the envelope (opaque passthrough), so the webview contract stays the single
 * source of truth for what the phone can see and do.
 *
 * Transport today is WebSocket (wss://…/ws/ext and wss://…/ws/app), but the
 * frame shape is deliberately transport-agnostic: an SSE-down/POST-up fallback
 * would reuse these types verbatim.
 *
 * Resume semantics: NO server-side buffering. When a phone (re)connects, the
 * server sends the extension `resync{to:connId}`; the bridge answers with a
 * targeted `e2w{to}` carrying a fresh state snapshot + session list — exactly
 * what LunoController.attach() does for a local webview. Missed chunks are
 * irrelevant because the snapshot carries the full messages array.
 */

import type { ExtensionToWebview, RemoteScope, WebviewToExtension } from "./index";

/** Close codes with meaning beyond "gone". */
export const RELAY_CLOSE_REVOKED = 4401; // phone: wipe token, back to welcome
export const RELAY_CLOSE_BAD_KEY = 4403; // ext: key mismatch for this extId

/** QR payload prefix — the webapp scanner accepts `luno-pair:XXXXXX`. */
export const PAIR_QR_PREFIX = "luno-pair:";

/** Telegram identity captured at claim time (from validated initData). */
export interface RelayTgUser {
  id: number;
  username?: string;
  firstName?: string;
}

export type RelayFrame =
  // --- handshake (first frame on any socket) ---
  | {
      v: 1;
      kind: "hello";
      role: "ext";
      /** Stable extension-instance uuid (globalState). */
      extId: string;
      /** Instance secret, TOFU-bound to extId on the relay. */
      key: string;
      /** Current workspace fingerprint, for project-scope checks. */
      workspace?: { name: string; hash: string };
    }
  | { v: 1; kind: "hello"; role: "app"; deviceToken: string }
  | {
      v: 1;
      kind: "helloOk";
      /** app only: */
      extOnline?: boolean;
      scope?: RemoteScope;
      deviceId?: string;
    }
  | { v: 1; kind: "helloErr"; code: "badToken" | "badKey" | "revoked"; message: string }

  // --- pairing (ext socket only) ---
  | { v: 1; kind: "pairNew" } // ext → server
  | { v: 1; kind: "pairCode"; code: string; expiresAt: number } // server → ext
  | {
      v: 1;
      kind: "pairClaimed";
      deviceId: string;
      scope: RemoteScope;
      tg: RelayTgUser;
    } // server → ext
  | { v: 1; kind: "deviceRevoke"; deviceId: string } // ext → server
  | { v: 1; kind: "deviceSync"; deviceIds: string[] } // ext → server: full mirror, server prunes the rest

  // --- payload relay (opaque to the server) ---
  | {
      v: 1;
      kind: "e2w";
      /** Target app connId; omitted = fan-out to every phone of this ext. */
      to?: string;
      payload: ExtensionToWebview;
    }
  | {
      v: 1;
      kind: "w2e";
      /** App connId — STAMPED BY THE SERVER, never client-supplied. */
      from: string;
      /** Device id — STAMPED BY THE SERVER, never client-supplied. */
      deviceId: string;
      payload: WebviewToExtension;
    }

  // --- liveness / resume ---
  | { v: 1; kind: "presence"; extOnline: boolean } // server → apps
  | { v: 1; kind: "resync"; to: string } // server → ext (new app joined)
  | { v: 1; kind: "ping" }
  | { v: 1; kind: "pong" };

/** Parse a frame defensively (relay + both clients). Returns null on garbage. */
export function parseRelayFrame(raw: unknown): RelayFrame | null {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") return null;
    const f = data as { v?: unknown; kind?: unknown };
    if (f.v !== 1 || typeof f.kind !== "string") return null;
    return data as RelayFrame;
  } catch {
    return null;
  }
}
