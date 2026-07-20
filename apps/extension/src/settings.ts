import type { LunoSettings } from "./types";
import {
  DEFAULT_AUTO_APPROVE,
  DEFAULT_CONTEXT,
  DEFAULT_DISPLAY,
  DEFAULT_REMOTE,
} from "./types";
import type { ConfigStore } from "./configStore";

export type { LunoSettings };

/**
 * Thin facade over ConfigStore so existing call-sites keep compiling.
 *
 * Settings used to read straight from the vscode `luno.*` configuration; they
 * now live in the single `luno.json` file owned by ConfigStore. Rather than
 * rewrite every reader/writer, this module holds a reference to the store and
 * proxies the two operations the old API exposed. `registerConfigStore` must be
 * called once during activation, right after `ConfigStore.init()`.
 */
let store: ConfigStore | undefined;

/** Fallback used before the store is registered so readers never throw. */
const DEFAULTS: LunoSettings = {
  gatewayUrl: "https://api.luno.codes",
  defaultModel: "claude-sonnet-4.6",
  streamResponses: true,
  showSonnetEqCost: false,
  approvalMode: "ask",
  sshEnabled: true,
  notifications: {
    enabled: true,
    onComplete: true,
    onApproval: true,
    onError: true,
    sound: true,
    osBanner: false,
  },
  autoApprove: { ...DEFAULT_AUTO_APPROVE },
  context: { ...DEFAULT_CONTEXT },
  display: { ...DEFAULT_DISPLAY },
  remote: { ...DEFAULT_REMOTE },
  language: "auto",
};

export function registerConfigStore(s: ConfigStore): void {
  store = s;
}

/** Never throws; returns defaults until the store is registered. */
export function readSettings(): LunoSettings {
  return store ? store.get("settings") : DEFAULTS;
}

export async function writeSetting<K extends keyof LunoSettings>(
  key: K,
  value: LunoSettings[K],
): Promise<void> {
  if (!store) return; // pre-init writes are a no-op; defaults still read
  await store.updateSettings({ [key]: value } as Partial<LunoSettings>);
}
