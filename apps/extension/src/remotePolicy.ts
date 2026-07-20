/**
 * Remote-control scope policy — what a paired phone may ask the extension to
 * do. Pure module (no vscode import) so it can be unit-tested standalone.
 *
 * Enforcement lives HERE, on the PC: the relay server is never trusted for
 * scope. A compromised relay can read mirrored traffic but cannot widen a
 * device's permissions.
 */

import type { RemoteDevice, WebviewToExtension } from "./types";

/**
 * Blocked for every remote device regardless of scope — these either open
 * local VS Code dialogs (useless on a phone) or mutate the PC's account link,
 * which must stay a physical-access action.
 */
const ALWAYS_BLOCKED = new Set<WebviewToExtension["type"]>([
  "addContext", // opens a local file picker
  "openConfigFile",
  "exportConfig",
  "importConfig",
  "startOAuth",
  "buyReset",
  "openBilling",
  "openSettings", // navigation is owned by each screen, never remote-driven
  "login",
  "submitKey",
  "cancelLink",
]);

/** Project scope: chat/agent interaction + session management only. */
const PROJECT_ALLOWED = new Set<WebviewToExtension["type"]>([
  "ready",
  "sendPrompt",
  "stop",
  "newChat",
  "selectModel",
  "approveToolCall",
  "sshAddResolve",
  "sshPickResolve",
  "listSessions",
  "loadSession",
  "deleteSession",
  "renameSession",
  "remoteStatus",
]);

export type PolicyVerdict = { ok: true } | { ok: false; reason: string };

export function allowRemoteMessage(
  msg: WebviewToExtension,
  device: RemoteDevice,
  currentWorkspaceHash: string | undefined,
): PolicyVerdict {
  if (ALWAYS_BLOCKED.has(msg.type)) {
    return { ok: false, reason: "This action is not available from the phone." };
  }

  if (device.scope === "system") return { ok: true };

  // --- project scope ---
  if (!PROJECT_ALLOWED.has(msg.type)) {
    return { ok: false, reason: "Full access required — this device is project-only." };
  }
  // The device is bound to the workspace that was open at pairing time. No
  // folder open (undefined hash) counts as a mismatch, never a wildcard.
  if (!device.workspaceHash || device.workspaceHash !== currentWorkspaceHash) {
    return {
      ok: false,
      reason: `This device is paired to project "${device.workspaceName ?? "?"}".`,
    };
  }
  return { ok: true };
}
