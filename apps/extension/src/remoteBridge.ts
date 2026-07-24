/**
 * Remote bridge — mirrors the extension to Telegram WebApp phones through the
 * relay server (wss://webapp-events.luno.codes — the dedicated WS hostname;
 * webapp.luno.codes serves only UI + REST; both are Cloudflare-proxied).
 *
 * The design trick: the bridge is just ANOTHER POSTER on the controller
 * (`controller.attach`), exactly like the sidebar or a tab panel — so every
 * broadcast (chunks, agent steps, approvals, state) reaches the phone with
 * zero controller changes. Inbound phone messages pass the scope policy
 * (remotePolicy.ts) and then flow into `controller.handle()` as if a local
 * webview had sent them.
 *
 * Trust model: the relay is untrusted for AUTHORIZATION. The device list that
 * scope checks read lives in globalState here, written only on pairClaimed /
 * revoke — a lying relay cannot widen a device's scope or resurrect a revoked
 * one.
 */

import * as vscode from "vscode";
import * as crypto from "node:crypto";
import WebSocket from "ws";
import type { LunoController, RemoteBridgeLike } from "./controller";
import { readSettings, writeSetting } from "./settings";
import { allowRemoteMessage } from "./remotePolicy";
import {
  parseRelayFrame,
  type ExtensionToWebview,
  type RelayFrame,
  type RemoteDevice,
  type RemoteStatus,
  type WebviewToExtension,
} from "./types";

const EXT_ID_KEY = "luno.remote.extId";
const EXT_SECRET_KEY = "luno.remote.extKey";
const DEVICES_KEY = "luno.remote.devices";

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
// Liveness: the relay protocol-pings every 30s, and we ping it every 25s. If
// NOTHING (frame/ping/pong) arrives for 75s — 2 missed server pings + margin —
// the socket is a zombie (silent TCP death after laptop sleep / network
// switch / a proxy drop) and must be cycled. Without this the socket stayed
// "OPEN" for many minutes while the relay had long marked us offline, so
// phones showed "PC offline" and the extension never noticed.
const PING_INTERVAL_MS = 25_000;
const LIVENESS_TIMEOUT_MS = 75_000;
const LIVENESS_SWEEP_MS = 15_000;

export class RemoteBridge implements RemoteBridgeLike {
  private ws?: WebSocket;
  private detach?: () => void;
  private helloOk = false;
  private reconnectTimer?: NodeJS.Timeout;
  private backoffMs = BACKOFF_MIN_MS;
  /** True between start() and stop() — gates the reconnect loop. */
  private running = false;
  /** URL the current socket was opened against, to detect settings changes. */
  private connectedUrl?: string;
  private pairing?: { code: string; expiresAt: number };
  private pairingTimer?: NodeJS.Timeout;
  /** Shown once per hard auth failure so reconnect loops don't spam. */
  private warnedBadKey = false;
  /** Prevent parallel recovery attempts if a relay repeats helloErr. */
  private recoveringIdentity = false;
  /** Timestamp of the last frame/ping/pong from the relay (liveness). */
  private lastActivityAt = 0;
  private pingTimer?: NodeJS.Timeout;
  private livenessTimer?: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: LunoController,
  ) {}

  // --- identity ---------------------------------------------------------------
  //
  // extId + extKey together form the extension's TOFU identity on the relay.
  // BOTH live in globalState (not Secret Storage): a paired phone binds to this
  // extId forever, so the identity MUST survive a reinstall. Secret Storage can
  // be wiped on reinstall, which would rotate the key, get the relay's `badKey`,
  // and orphan every paired phone — so we deliberately keep the key in the same
  // durable store as the id. (The key only authorises a relay socket; it is not
  // an account credential, and the relay stores only its hash.)

  private extId(): string {
    let id = this.context.globalState.get<string>(EXT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      void this.context.globalState.update(EXT_ID_KEY, id);
    }
    return id;
  }

  private async extKey(): Promise<string> {
    let key = this.context.globalState.get<string>(EXT_SECRET_KEY);
    if (!key) {
      // One-time migration: an older build stored the key in Secret Storage.
      // Move it into globalState so it now survives reinstalls with the extId.
      const legacy = await this.context.secrets.get(EXT_SECRET_KEY);
      key = legacy || crypto.randomBytes(32).toString("hex");
      await this.context.globalState.update(EXT_SECRET_KEY, key);
    }
    return key;
  }

  // --- device mirror ------------------------------------------------------------

  private devices(): RemoteDevice[] {
    return this.context.globalState.get<RemoteDevice[]>(DEVICES_KEY) ?? [];
  }

  private async saveDevices(devices: RemoteDevice[]): Promise<void> {
    await this.context.globalState.update(DEVICES_KEY, devices);
  }

  // --- workspace fingerprint ----------------------------------------------------

  private workspaceInfo(): { name: string; hash: string } | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    return {
      name: folder.name,
      hash: crypto.createHash("sha256").update(folder.uri.fsPath).digest("hex"),
    };
  }

  // --- lifecycle ----------------------------------------------------------------

  start(): void {
    this.running = true;
    if (this.ws) return; // already connected/connecting
    void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.teardownSocket(true);
    this.broadcastStatus();
  }

  dispose(): void {
    this.stop();
  }

  /** Settings changed (enable toggle or server URL) — reconcile. */
  onSettingsChanged(): void {
    const remote = readSettings().remote;
    if (!remote.enabled) {
      if (this.running) this.stop();
      return;
    }
    const url = this.serverUrl();
    if (this.running && this.connectedUrl && this.connectedUrl !== url) {
      // URL changed under a live connection: cycle it.
      this.teardownSocket(true);
    }
    this.start();
  }

  private serverUrl(): string {
    return readSettings().remote.serverUrl.replace(/\/+$/, "");
  }

  private async connect(): Promise<void> {
    if (!this.running || this.ws) return;
    const url = this.serverUrl() + "/ws/ext";
    const key = await this.extKey();
    if (!this.running || this.ws) return; // stopped while awaiting the secret

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.connectedUrl = this.serverUrl();
    this.lastActivityAt = Date.now();

    ws.on("open", () => {
      this.lastActivityAt = Date.now();
      this.sendFrame({
        v: 1,
        kind: "hello",
        role: "ext",
        extId: this.extId(),
        key,
        workspace: this.workspaceInfo(),
      });
      this.startKeepalive(ws);
    });

    ws.on("message", (raw) => {
      this.lastActivityAt = Date.now();
      const frame = parseRelayFrame(raw.toString());
      if (frame) this.onFrame(frame);
    });

    // Relay protocol-pings us every 30s (ws lib answers pongs automatically);
    // both directions count as proof of life.
    ws.on("ping", () => (this.lastActivityAt = Date.now()));
    ws.on("pong", () => (this.lastActivityAt = Date.now()));

    const onGone = () => {
      if (this.ws !== ws) return; // an old socket's death, not ours
      this.teardownSocket(false);
      this.broadcastStatus();
      this.scheduleReconnect();
    };
    ws.on("close", onGone);
    ws.on("error", onGone);
  }

  /**
   * Client-side keepalive + zombie watchdog for THIS socket.
   *
   * Keepalive: a protocol ping every 25s keeps bytes flowing in both
   * directions, which matters behind Cloudflare — CF kills proxied WebSockets
   * after ~100s without traffic, and one direction being chatty is not enough.
   *
   * Watchdog: if nothing has arrived for LIVENESS_TIMEOUT_MS the connection is
   * half-dead (TCP never errored — laptop sleep, Wi-Fi switch, CF drop with
   * lost FIN). terminate() forces the 'close' event, which drives the normal
   * reconnect path. Timers are per-socket and die with it in teardownSocket.
   */
  private startKeepalive(ws: WebSocket): void {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.ws !== ws) return;
      try {
        ws.ping();
      } catch {
        /* socket already closing */
      }
    }, PING_INTERVAL_MS);
    this.livenessTimer = setInterval(() => {
      if (this.ws !== ws) return;
      if (Date.now() - this.lastActivityAt > LIVENESS_TIMEOUT_MS) {
        try {
          ws.terminate(); // fires 'close' → teardown + reconnect
        } catch {
          /* already dead */
        }
      }
    }, LIVENESS_SWEEP_MS);
  }

  private stopKeepalive(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.pingTimer = undefined;
    this.livenessTimer = undefined;
  }

  private teardownSocket(intentional: boolean): void {
    this.stopKeepalive();
    this.detach?.();
    this.detach = undefined;
    this.helloOk = false;
    const ws = this.ws;
    this.ws = undefined;
    if (ws && intentional) {
      try {
        ws.close(1000);
      } catch {
        /* already dead */
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    // ±20% jitter so a fleet of extensions doesn't thundering-herd the relay.
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(this.backoffMs * jitter);
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  // --- frames -------------------------------------------------------------------

  private sendFrame(frame: RelayFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private sendE2W(payload: ExtensionToWebview, to?: string): void {
    this.sendFrame({ v: 1, kind: "e2w", to, payload });
  }

  /**
   * Controller broadcast → phones. Messages carrying cross-project data
   * (full state / session lists) are re-sent PER DEVICE via `toDevice`, each
   * copy filtered to that device's scope — a project-paired phone never even
   * receives other projects' chat titles. Everything else (chunks, steps,
   * approvals of the live turn) fans out verbatim.
   */
  private mirrorToPhones(msg: ExtensionToWebview): void {
    if (msg.type !== "state" && msg.type !== "sessions") {
      this.sendE2W(msg);
      return;
    }
    const devices = this.devices();
    if (devices.length === 0) return; // nobody paired — nothing to mirror
    if (devices.every((d) => d.scope === "system")) {
      this.sendE2W(msg); // no filtering needed — one fan-out frame
      return;
    }
    for (const device of devices) {
      this.sendFrame({
        v: 1,
        kind: "e2w",
        toDevice: device.id,
        payload: this.filterForDevice(msg, device),
      });
    }
  }

  /** Scope filter for one device. System scope sees everything; project scope
   *  sees only sessions stamped with ITS workspace, and no live chat at all
   *  when the PC currently has a different project open. */
  private filterForDevice(
    msg: ExtensionToWebview,
    device: RemoteDevice,
  ): ExtensionToWebview {
    if (device.scope === "system") return msg;
    const hash = device.workspaceHash;

    if (msg.type === "sessions") {
      return {
        ...msg,
        sessions: msg.sessions.filter(
          (s) => s.workspaceHash && s.workspaceHash === hash,
        ),
      };
    }
    if (msg.type === "state") {
      const sessions = (msg.state.sessions ?? []).filter(
        (s) => s.workspaceHash && s.workspaceHash === hash,
      );
      if (!hash || hash !== this.workspaceInfo()?.hash) {
        // Paired to a different project than the one open on the PC — the
        // live chat/draft is not theirs to see. Interaction is already
        // rejected by remotePolicy with a clear reason.
        return {
          ...msg,
          state: {
            ...msg.state,
            messages: [],
            sessions,
            activeSessionId: undefined,
            draft: undefined,
          },
        };
      }
      return { ...msg, state: { ...msg.state, sessions } };
    }
    return msg;
  }

  private onFrame(frame: RelayFrame): void {
    switch (frame.kind) {
      case "helloOk":
        this.helloOk = true;
        this.backoffMs = BACKOFF_MIN_MS;
        this.warnedBadKey = false;
        // THE key line: register as a poster — every controller broadcast now
        // mirrors to the phones (scope-filtered per device where needed).
        // attach() also pushes a state snapshot.
        this.detach?.();
        this.detach = this.controller.attach((msg) => this.mirrorToPhones(msg));
        // Reconcile: revokes done while offline never reached the relay — our
        // mirror is the source of truth, so the server prunes everything else.
        this.sendFrame({
          v: 1,
          kind: "deviceSync",
          deviceIds: this.devices().map((d) => d.id),
        });
        this.broadcastStatus();
        break;

      case "helloErr":
        if (frame.code === "badKey") {
          // The relay has our extId TOFU-bound to a different key. With the key
          // now stored durably alongside the extId (globalState), this should
          // never happen on a normal reinstall. If it does, the relay's record
          // is stale (e.g. it was reset) — tell the user how to recover but
          // KEEP retrying with backoff (never dead-end), since a relay restart
          // that clears its registry will accept us again on the next attempt.
          void this.recoverRejectedIdentity();
        }
        break;

      case "pairCode": {
        this.pairing = { code: frame.code, expiresAt: frame.expiresAt };
        if (this.pairingTimer) clearTimeout(this.pairingTimer);
        this.pairingTimer = setTimeout(() => {
          this.pairing = undefined;
          this.broadcastStatus();
        }, Math.max(0, frame.expiresAt - Date.now()));
        this.broadcastStatus();
        break;
      }

      case "pairClaimed": {
        const label = frame.tg.username
          ? `@${frame.tg.username}`
          : (frame.tg.firstName ?? "Telegram user");
        const ws = this.workspaceInfo();
        const device: RemoteDevice = {
          id: frame.deviceId,
          label,
          tgId: frame.tg.id,
          scope: frame.scope,
          workspaceHash: frame.scope === "project" ? ws?.hash : undefined,
          workspaceName: frame.scope === "project" ? ws?.name : undefined,
          createdAt: Date.now(),
        };
        void this.saveDevices([...this.devices(), device]).then(() => {
          this.pairing = undefined;
          if (this.pairingTimer) clearTimeout(this.pairingTimer);
          void vscode.window.showInformationMessage(
            `Luno: ${label} paired (${frame.scope === "project" ? "this project" : "full access"}).`,
          );
          this.broadcastStatus();
        });
        break;
      }

      case "resync": {
        // A phone (re)joined — give it the same snapshot a fresh webview gets,
        // filtered for the device's scope. The relay stamps deviceId on resync
        // frames; if it's absent (old relay) fail CLOSED with a synthetic
        // project-scoped device, which strips everything cross-project.
        const device =
          (frame.deviceId
            ? this.devices().find((d) => d.id === frame.deviceId)
            : undefined) ?? ({ scope: "project" } as RemoteDevice);
        this.controller.resyncPoster((msg) =>
          this.sendE2W(this.filterForDevice(msg, device), frame.to),
        );
        break;
      }

      case "w2e":
        this.onRemoteMessage(frame);
        break;

      case "ping":
        this.sendFrame({ v: 1, kind: "pong" });
        break;

      default:
        break;
    }
  }

  private onRemoteMessage(frame: Extract<RelayFrame, { kind: "w2e" }>): void {
    const device = this.devices().find((d) => d.id === frame.deviceId);
    const payload = frame.payload as WebviewToExtension;
    if (!device) {
      // Not in OUR mirror — revoked or forged. Kill it relay-side too.
      this.sendFrame({ v: 1, kind: "deviceRevoke", deviceId: frame.deviceId });
      this.sendE2W({ type: "error", message: "Device revoked." }, frame.from);
      return;
    }
    const verdict = allowRemoteMessage(payload, device, this.workspaceInfo()?.hash);
    if (!verdict.ok) {
      this.sendE2W({ type: "error", message: verdict.reason }, frame.from);
      return;
    }
    // Project scope: chats of other projects are invisible AND untouchable —
    // the mirror filters them out of lists, and this guard stops direct-id
    // loads/deletes/renames (an id could be remembered from before a revoke).
    if (
      device.scope === "project" &&
      (payload.type === "loadSession" ||
        payload.type === "deleteSession" ||
        payload.type === "renameSession") &&
      !this.controller.isSessionInWorkspace(payload.id)
    ) {
      this.sendE2W(
        { type: "error", message: "This chat belongs to another project." },
        frame.from,
      );
      return;
    }
    // Touch lastSeenAt lazily (no await — best effort, UI-only field).
    device.lastSeenAt = Date.now();
    void this.saveDevices(this.devices().map((d) => (d.id === device.id ? device : d)));
    void this.controller.handle(payload, {
      kind: "remote",
      scope: device.scope,
      deviceId: device.id,
    });
  }

  // --- RemoteBridgeLike (settings tab surface) -----------------------------------

  status(): RemoteStatus {
    return {
      enabled: readSettings().remote.enabled,
      serverUrl: readSettings().remote.serverUrl,
      connected: this.helloOk && this.ws?.readyState === WebSocket.OPEN,
      devices: this.devices(),
      pairing: this.pairing,
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await writeSetting("remote", { ...readSettings().remote, enabled });
    if (enabled) this.start();
    else this.stop();
    this.broadcastStatus();
  }

  requestPairCode(): void {
    if (this.helloOk) {
      this.sendFrame({ v: 1, kind: "pairNew" });
    } else {
      // Not connected — status broadcast lets the tab render the hint.
      this.broadcastStatus();
    }
  }

  async revoke(deviceId: string): Promise<void> {
    await this.saveDevices(this.devices().filter((d) => d.id !== deviceId));
    // Relay cleanup is best-effort: even if it never hears this, the device is
    // already dead here (unknown ids are rejected in onRemoteMessage).
    this.sendFrame({ v: 1, kind: "deviceRevoke", deviceId });
    this.broadcastStatus();
  }

  /**
   * Repair a stale relay TOFU identity. A badKey response is permanent for the
   * current id/key pair, so ordinary reconnects cannot help. Phone tokens are
   * bound to that rejected identity and must be paired again after rotation.
   */
  private async recoverRejectedIdentity(): Promise<void> {
    if (this.recoveringIdentity) return;
    this.recoveringIdentity = true;
    try {
      await this.context.globalState.update(EXT_ID_KEY, crypto.randomUUID());
      await this.context.globalState.update(
        EXT_SECRET_KEY,
        crypto.randomBytes(32).toString("hex"),
      );
      await this.saveDevices([]);
      this.teardownSocket(true);
      this.backoffMs = BACKOFF_MIN_MS;
      if (!this.warnedBadKey) {
        this.warnedBadKey = true;
        void vscode.window.showWarningMessage(
          "Luno Remote repaired a rejected relay identity. Pair your phone again.",
        );
      }
      this.broadcastStatus();
      if (this.running) void this.connect();
    } finally {
      this.recoveringIdentity = false;
    }
  }

  private broadcastStatus(): void {
    this.controller.broadcastFromService({ type: "remote", status: this.status() });
  }
}
