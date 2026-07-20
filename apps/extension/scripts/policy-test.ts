/**
 * Unit test for remotePolicy.allowRemoteMessage — the security-critical piece
 * of the remote bridge. Run: npx tsx scripts/policy-test.ts
 */

import { allowRemoteMessage } from "../src/remotePolicy";
import type { RemoteDevice, WebviewToExtension } from "../src/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}`);
  }
}

const WS_HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const systemDev: RemoteDevice = {
  id: "d1",
  label: "@user",
  tgId: 1,
  scope: "system",
  createdAt: 0,
};
const projectDev: RemoteDevice = {
  id: "d2",
  label: "@user",
  tgId: 1,
  scope: "project",
  workspaceHash: WS_HASH,
  workspaceName: "my-app",
  createdAt: 0,
};

const send: WebviewToExtension = { type: "sendPrompt", text: "hi" };
const setting: WebviewToExtension = { type: "updateSetting", key: "language", value: "en" };
const addCtx: WebviewToExtension = { type: "addContext" };
const logout: WebviewToExtension = { type: "logout" };
const approve: WebviewToExtension = { type: "approveToolCall", stepId: "s1", approved: true };
const stop: WebviewToExtension = { type: "stop" };
const provider: WebviewToExtension = { type: "deleteProvider", id: "p1" };
const revoke: WebviewToExtension = { type: "remoteRevoke", deviceId: "dX" };

// --- system scope ---
check("system: sendPrompt allowed", allowRemoteMessage(send, systemDev, WS_HASH).ok);
check("system: updateSetting allowed", allowRemoteMessage(setting, systemDev, WS_HASH).ok);
check("system: logout allowed", allowRemoteMessage(logout, systemDev, WS_HASH).ok);
check("system: provider CRUD allowed", allowRemoteMessage(provider, systemDev, WS_HASH).ok);
check("system: remoteRevoke allowed", allowRemoteMessage(revoke, systemDev, WS_HASH).ok);
check("system: addContext BLOCKED", !allowRemoteMessage(addCtx, systemDev, WS_HASH).ok);
check(
  "system: openConfigFile BLOCKED",
  !allowRemoteMessage({ type: "openConfigFile" }, systemDev, WS_HASH).ok,
);
check(
  "system: submitKey BLOCKED",
  !allowRemoteMessage({ type: "submitKey", key: "sk-x" }, systemDev, WS_HASH).ok,
);
check("system: works with no folder open", allowRemoteMessage(send, systemDev, undefined).ok);

// --- project scope, matching workspace ---
check("project+match: sendPrompt allowed", allowRemoteMessage(send, projectDev, WS_HASH).ok);
check("project+match: stop allowed", allowRemoteMessage(stop, projectDev, WS_HASH).ok);
check("project+match: approve allowed", allowRemoteMessage(approve, projectDev, WS_HASH).ok);
check(
  "project+match: loadSession allowed",
  allowRemoteMessage({ type: "loadSession", id: "s" }, projectDev, WS_HASH).ok,
);
check("project+match: updateSetting DENIED", !allowRemoteMessage(setting, projectDev, WS_HASH).ok);
check("project+match: logout DENIED", !allowRemoteMessage(logout, projectDev, WS_HASH).ok);
check("project+match: provider CRUD DENIED", !allowRemoteMessage(provider, projectDev, WS_HASH).ok);
check("project+match: remoteRevoke DENIED", !allowRemoteMessage(revoke, projectDev, WS_HASH).ok);
check("project+match: addContext BLOCKED", !allowRemoteMessage(addCtx, projectDev, WS_HASH).ok);

// --- project scope, wrong/no workspace ---
const wrongWs = allowRemoteMessage(send, projectDev, OTHER_HASH);
check("project+wrong ws: sendPrompt DENIED", !wrongWs.ok);
check(
  "project+wrong ws: reason names the project",
  !wrongWs.ok && wrongWs.reason.includes("my-app"),
);
check("project+no folder: DENIED", !allowRemoteMessage(send, projectDev, undefined).ok);
const noHashDev: RemoteDevice = { ...projectDev, workspaceHash: undefined };
check(
  "project device without recorded hash: DENIED even on match",
  !allowRemoteMessage(send, noHashDev, WS_HASH).ok,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
