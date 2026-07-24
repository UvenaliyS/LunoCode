import * as vscode from "vscode";
import type {
  LunoSettings,
  NotificationSettings,
  AutoApproveSettings,
  ContextSettings,
  DisplaySettings,
  RemoteSettings,
  ProviderFormat,
  ProviderTestResult,
  SshServerMeta,
} from "./types";
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_AUTO_APPROVE,
  DEFAULT_CONTEXT,
  DEFAULT_DISPLAY,
  DEFAULT_REMOTE,
} from "./types";

/** Provider entry persisted in luno.json — no secrets ever. */
export interface StoredProvider {
  id: string;
  label: string;
  kind: "luno" | "custom";
  endpoint: string;
  format?: ProviderFormat;
  autoFormat?: boolean;
  modelFormats?: Record<string, ProviderFormat>;
  lastTest?: ProviderTestResult;
}

export interface LunoConfig {
  settings: LunoSettings;
  providers: StoredProvider[];
  ssh: SshServerMeta[];
}

/** The one config file we own inside globalStorageUri. */
const FILE_NAME = "luno.json";

/**
 * The full default config. Settings pull the notification defaults from the
 * shared contract so the two never drift. Everything else is seeded here and is
 * also the fallback for any key missing from an on-disk / imported file.
 */
const DEFAULT_CONFIG: LunoConfig = {
  settings: {
    gatewayUrl: "https://api.luno.codes",
    defaultModel: "claude-sonnet-4.6",
    streamResponses: true,
    showSonnetEqCost: false,
    approvalMode: "ask",
    sshEnabled: true,
    notifications: { ...DEFAULT_NOTIFICATIONS },
    autoApprove: { ...DEFAULT_AUTO_APPROVE },
    context: { ...DEFAULT_CONTEXT },
    display: { ...DEFAULT_DISPLAY },
    remote: { ...DEFAULT_REMOTE },
    language: "auto",
    hiddenModels: [],
    customModels: [],
  },
  providers: [],
  ssh: [],
};

/** Top-level keys we accept from disk / imports. Anything else is ignored. */
const ALLOWED_KEYS: (keyof LunoConfig)[] = ["settings", "providers", "ssh"];

/** Hard ceiling for an imported file — a settings blob is tiny; anything larger
 *  is almost certainly the wrong file (or hostile) and is rejected outright. */
const MAX_IMPORT_BYTES = 1024 * 1024;

/**
 * ConfigStore owns the single `luno.json` file in the extension's global
 * storage. This file is THE user-editable / exportable configuration: it is
 * hand-editable, watched for external edits, and round-trips through
 * export/import. Secrets (API keys, SSH credentials) deliberately never live
 * here — they stay in OS Secret Storage — so the file is safe to share.
 */
export class ConfigStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  readonly fileUri: vscode.Uri;
  private readonly dirUri: vscode.Uri;

  private config: LunoConfig = clone(DEFAULT_CONFIG);
  /** Serialized snapshot of what we last wrote, to distinguish our own writes
   *  from external edits when the file watcher fires. */
  private lastWritten = "";
  private watcher?: vscode.FileSystemWatcher;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.dirUri = context.globalStorageUri;
    this.fileUri = vscode.Uri.joinPath(this.dirUri, FILE_NAME);
  }

  async init(): Promise<void> {
    await this.ensureDir();
    const existing = await this.tryRead();
    if (existing) {
      this.config = mergeConfig(DEFAULT_CONFIG, existing);
    } else {
      // First run: seed from the legacy vscode `luno.*` configuration so users
      // upgrading from the settings.json era keep their setup.
      this.config = this.migrateFromLegacy();
      await this.persist();
    }
    this.startWatching();
  }

  get<K extends keyof LunoConfig>(key: K): LunoConfig[K] {
    return clone(this.config[key]);
  }

  getAll(): LunoConfig {
    return clone(this.config);
  }

  async update<K extends keyof LunoConfig>(
    key: K,
    value: LunoConfig[K],
  ): Promise<void> {
    this.config = { ...this.config, [key]: clone(value) };
    await this.persist();
    this._onDidChange.fire();
  }

  /** Patch settings without disturbing providers/ssh; nested objects
   *  (notifications, autoApprove, context, display) deep-merge key-by-key. */
  async updateSettings(patch: Partial<LunoSettings>): Promise<void> {
    const next = mergeSettings(this.config.settings, patch);
    await this.update("settings", next);
  }

  /** Open the raw file for hand-editing; the watcher picks up saves. */
  async openInEditor(): Promise<void> {
    await this.ensureDir();
    if (!(await this.tryRead())) await this.persist();
    const doc = await vscode.workspace.openTextDocument(this.fileUri);
    await vscode.window.showTextDocument(doc);
  }

  async exportToFile(): Promise<{ ok: boolean; detail?: string }> {
    const target = await vscode.window.showSaveDialog({
      saveLabel: "Export Luno settings",
      defaultUri: vscode.Uri.joinPath(this.dirUri, "luno-settings.json"),
      filters: { JSON: ["json"] },
    });
    if (!target) return { ok: false, detail: "Cancelled" };
    // No redaction needed: the config never contains secrets by design (API
    // keys and SSH credentials live in Secret Storage, not in this file).
    const payload = {
      ...this.config,
      _meta: { version: 1, exportedAt: new Date().toISOString() },
    };
    try {
      await vscode.workspace.fs.writeFile(target, encode(pretty(payload)));
      return { ok: true, detail: target.fsPath };
    } catch (e) {
      return { ok: false, detail: errMsg(e) };
    }
  }

  async importFromFile(): Promise<{ ok: boolean; detail?: string }> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Import Luno settings",
      filters: { JSON: ["json"] },
    });
    if (!picked || picked.length === 0) return { ok: false, detail: "Cancelled" };

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(picked[0]);
    } catch (e) {
      return { ok: false, detail: errMsg(e) };
    }
    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      return { ok: false, detail: "File too large (max 1MB)" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(decode(bytes));
    } catch {
      return { ok: false, detail: "Not valid JSON" };
    }
    if (!isObject(parsed)) {
      return { ok: false, detail: "Config must be a JSON object" };
    }

    const meta = (parsed as Record<string, unknown>)._meta;
    const version =
      isObject(meta) && typeof meta.version === "number" ? meta.version : 1;

    // Keep only known top-level keys (drops _meta and anything unexpected).
    const filtered: Partial<LunoConfig> = {};
    for (const key of ALLOWED_KEYS) {
      if (key in (parsed as Record<string, unknown>)) {
        (filtered as Record<string, unknown>)[key] = (
          parsed as Record<string, unknown>
        )[key];
      }
    }
    if (Object.keys(filtered).length === 0) {
      return { ok: false, detail: "No recognizable settings in file" };
    }

    // Imported values win; arrays are replaced wholesale (not merged element-wise).
    this.config = mergeConfig(this.config, filtered);
    await this.persist();
    this._onDidChange.fire();

    const note =
      version > 1
        ? ` (file version ${version} is newer than this build — unknown keys were ignored)`
        : "";
    return { ok: true, detail: "Settings imported" + note };
  }

  dispose(): void {
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }

  // --- internals ---------------------------------------------------------

  private async ensureDir(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.dirUri);
    } catch {
      // Already exists (or a race) — createDirectory is idempotent enough.
    }
  }

  private async tryRead(): Promise<Partial<LunoConfig> | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri);
      const parsed = JSON.parse(decode(bytes));
      return isObject(parsed) ? (parsed as Partial<LunoConfig>) : undefined;
    } catch {
      return undefined;
    }
  }

  private async persist(): Promise<void> {
    const json = pretty(this.config);
    this.lastWritten = json;
    await this.ensureDir();
    await vscode.workspace.fs.writeFile(this.fileUri, encode(json));
  }

  private startWatching(): void {
    // Watch just our file inside the storage dir. External edits (hand-editing,
    // sync) reload; our own writes are filtered out via the snapshot compare.
    const pattern = new vscode.RelativePattern(this.dirUri, FILE_NAME);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onFsEvent = () => void this.onExternalChange();
    this.watcher.onDidChange(onFsEvent);
    this.watcher.onDidCreate(onFsEvent);
    this.context.subscriptions.push(this.watcher);
  }

  private async onExternalChange(): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(this.fileUri);
    } catch {
      return; // deleted mid-flight; keep last good state
    }
    const raw = decode(bytes);
    if (raw === this.lastWritten) return; // our own write echoing back

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep the last good state so a fat-fingered edit can't wipe the config.
      void vscode.window.showWarningMessage(
        "luno.json is not valid JSON — keeping the previous settings.",
      );
      return;
    }
    if (!isObject(parsed)) return;
    this.config = mergeConfig(DEFAULT_CONFIG, parsed as Partial<LunoConfig>);
    this.lastWritten = raw;
    this._onDidChange.fire();
  }

  /** Seed the first config from the legacy `luno.*` vscode settings. */
  private migrateFromLegacy(): LunoConfig {
    const legacy = vscode.workspace.getConfiguration("luno");
    const base = clone(DEFAULT_CONFIG);
    const s = base.settings;
    s.gatewayUrl = legacy.get("gatewayUrl", s.gatewayUrl);
    s.defaultModel = legacy.get("defaultModel", s.defaultModel);
    s.streamResponses = legacy.get("streamResponses", s.streamResponses);
    s.showSonnetEqCost = legacy.get("showSonnetEqCost", s.showSonnetEqCost);
    s.approvalMode = legacy.get("approvalMode", s.approvalMode);

    base.providers = migrateLegacyProviders(
      vscode.workspace.getConfiguration().get<unknown[]>("luno.providers", []),
    );
    return base;
  }
}

/**
 * Map the legacy `luno.providers` array (old kinds "openai-v1"/"custom-v1") to
 * the new StoredProvider shape. The built-in Luno provider was stored as kind
 * "luno" back then but is now implicit, so those entries are dropped.
 */
function migrateLegacyProviders(raw: unknown[]): StoredProvider[] {
  const out: StoredProvider[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!isObject(item)) continue;
    const kind = String(item.kind ?? "");
    if (kind === "luno") continue; // built-in is implicit now
    const endpoint = typeof item.endpoint === "string" ? item.endpoint : "";
    if (!endpoint) continue;
    out.push({
      id: typeof item.id === "string" ? item.id : rid(),
      label: typeof item.label === "string" ? item.label : "Custom",
      kind: "custom",
      endpoint: endpoint.replace(/\/+$/, ""),
      format: "openai-v1",
    });
  }
  return out;
}

// --- helpers -------------------------------------------------------------

/**
 * Deep-merge a partial config over a base. Objects (settings, notifications)
 * merge key-by-key so a file missing keys can never crash us; arrays
 * (providers, ssh) are replaced wholesale — importing a provider list means
 * "use exactly this list", not "append".
 */
function mergeConfig(
  base: LunoConfig,
  patch: Partial<LunoConfig>,
): LunoConfig {
  const settings = mergeSettings(
    base.settings,
    isObject(patch.settings) ? (patch.settings as Partial<LunoSettings>) : {},
  );
  return {
    settings,
    providers: Array.isArray(patch.providers)
      ? (patch.providers as StoredProvider[])
      : clone(base.providers),
    ssh: Array.isArray(patch.ssh)
      ? (patch.ssh as SshServerMeta[])
      : clone(base.ssh),
  };
}

function mergeSettings(
  base: LunoSettings,
  patch: Partial<LunoSettings>,
): LunoSettings {
  const notifications: NotificationSettings = {
    ...base.notifications,
    ...(isObject(patch.notifications)
      ? (patch.notifications as Partial<NotificationSettings>)
      : {}),
  };
  const autoApprove: AutoApproveSettings = {
    ...base.autoApprove,
    ...(isObject(patch.autoApprove)
      ? (patch.autoApprove as Partial<AutoApproveSettings>)
      : {}),
  };
  // Read-only shell commands (pwd/ls/cat/…) are always safe to auto-run, so the
  // built-in defaults are unioned into whatever the user saved — a config
  // written before these were added still gets them without clobbering the
  // user's own extra entries.
  autoApprove.allowedCommands = Array.from(
    new Set([
      ...DEFAULT_AUTO_APPROVE.allowedCommands,
      ...(Array.isArray(autoApprove.allowedCommands)
        ? autoApprove.allowedCommands
        : []),
    ]),
  );
  const context: ContextSettings = {
    ...base.context,
    ...(isObject(patch.context)
      ? (patch.context as Partial<ContextSettings>)
      : {}),
  };
  const display: DisplaySettings = {
    ...base.display,
    ...(isObject(patch.display)
      ? (patch.display as Partial<DisplaySettings>)
      : {}),
  };
  const remote: RemoteSettings = {
    ...(base.remote ?? DEFAULT_REMOTE),
    ...(isObject(patch.remote) ? (patch.remote as Partial<RemoteSettings>) : {}),
  };
  // Migrate the pre-split default: webapp.luno.codes no longer serves WS at
  // all (it moved behind Fastly; sockets live on webapp-events via Cloudflare).
  if (remote.serverUrl === "wss://webapp.luno.codes") {
    remote.serverUrl = DEFAULT_REMOTE.serverUrl;
  }
  const merged = {
    ...base,
    ...patch,
    notifications,
    autoApprove,
    context,
    display,
    remote,
    hiddenModels: Array.isArray(patch.hiddenModels)
      ? patch.hiddenModels.filter((v): v is string => typeof v === "string")
      : base.hiddenModels,
    customModels: Array.isArray(patch.customModels)
      ? patch.customModels.filter(
          (v): v is LunoSettings["customModels"][number] =>
            isObject(v) && typeof v.id === "string" && typeof v.label === "string",
        )
      : base.customModels,
  };
  // Migrate dev-era defaults: the mock gateway on localhost and the dashed
  // model id it advertised. Only exact old defaults are rewritten — a user's
  // own custom gateway/model choice is never touched.
  if (merged.gatewayUrl === "http://127.0.0.1:8787") {
    merged.gatewayUrl = "https://api.luno.codes";
  }
  if (merged.defaultModel === "claude-sonnet-4-6") {
    merged.defaultModel = "claude-sonnet-4.6";
  }
  return merged;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decode(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function rid(): string {
  return "p_" + Math.random().toString(36).slice(2, 9);
}
