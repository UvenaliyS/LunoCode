import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type {
  Provider,
  ProviderFormat,
  ProviderTestResult,
} from "./types";
import { inferModelBrand, isLunoEndpoint } from "./types";
import type { ConfigStore, StoredProvider } from "./configStore";
import type { GatewayClient, ProviderTarget } from "./gatewayClient";

const KEY_PREFIX = "luno.providerKey.";
const LUNO_ID = "luno";

/**
 * Multi-API provider registry.
 *
 * The provider list (endpoint, kind, format, per-model overrides, last test)
 * lives in the ConfigStore's single JSON config file — NOT in VS Code settings
 * — so it is hand-editable and travels with export/import. API keys live in
 * Secret Storage keyed by provider id, never in the config file and never sent
 * to the webview. The built-in Luno provider is always present and cannot be
 * removed.
 */
export class ProviderStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  /** Last test outcome for the built-in Luno provider when it has no stored
   *  entry to persist into — kept in memory so the UI still shows it. */
  private lunoTest: ProviderTestResult | undefined;

  /** Returns the signed-in account's API key — injected by extension.ts
   *  (AuthManager) so the built-in Luno provider authenticates as the account
   *  instead of requiring a separately stored key. */
  private accountKey: () => string | undefined = () => undefined;

  setAccountKeyResolver(resolver: () => string | undefined): void {
    this.accountKey = resolver;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: ConfigStore,
    private readonly gateway: GatewayClient,
  ) {
    // Provider data lives in the config file, so any config change (including
    // hand-edits and import) may change the list — relay it. Our own
    // config.update calls fire through this same path, so we only fire
    // manually where the config is NOT touched (secrets, in-memory luno test).
    context.subscriptions.push(
      config.onDidChange(() => this._onDidChange.fire()),
      this._onDidChange,
    );
  }

  private stored(): StoredProvider[] {
    return this.config.get("providers") ?? [];
  }

  /** The built-in Luno provider. A stored entry with id "luno" (if any) only
   *  overrides the endpoint; otherwise we follow settings.gatewayUrl. */
  private lunoProvider(): Provider {
    const override = this.stored().find((p) => p.id === LUNO_ID);
    return {
      id: LUNO_ID,
      label: "Luno",
      kind: "luno",
      builtin: true,
      endpoint:
        override?.endpoint || this.config.get("settings").gatewayUrl,
      // Informational: the Luno gateway serves the Claude Code environment.
      format: "claude-code",
      lastTest: override?.lastTest ?? this.lunoTest,
    };
  }

  /** All providers, Luno first, with hasKey resolved from secrets. */
  async list(): Promise<Provider[]> {
    const out: Provider[] = [this.lunoProvider()];
    for (const p of this.stored()) {
      if (p.id === LUNO_ID) continue; // folded into the built-in entry above
      out.push({
        id: p.id,
        label: p.label,
        kind: p.kind,
        endpoint: p.endpoint,
        format: p.format,
        autoFormat: p.autoFormat,
        modelFormats: p.modelFormats,
        lastTest: p.lastTest,
      });
    }
    for (const p of out) {
      p.hasKey =
        p.builtin && p.kind === "luno"
          ? !!this.accountKey() || !!(await this.getKey(p.id))
          : !!(await this.getKey(p.id));
    }
    return out;
  }

  async get(id: string): Promise<Provider | undefined> {
    return (await this.list()).find((p) => p.id === id);
  }

  getKey(id: string): Thenable<string | undefined> {
    return this.context.secrets.get(KEY_PREFIX + id);
  }

  async setKey(id: string, key: string | undefined): Promise<void> {
    if (key && key.trim()) {
      await this.context.secrets.store(KEY_PREFIX + id, key.trim());
    } else {
      await this.context.secrets.delete(KEY_PREFIX + id);
    }
    // Secrets bypass the config file, so the relay won't fire for us.
    this._onDidChange.fire();
  }

  /**
   * Add or update a provider. Luno endpoints (any *.luno.codes host) are
   * autodetected and stored as kind "luno" — such endpoints speak the luno
   * gateway contract and the key is a Luno API key, so the user-picked format
   * is irrelevant and intentionally not stored. Returns the provider id.
   */
  async upsert(
    input: {
      id?: string;
      label: string;
      endpoint: string;
      format: ProviderFormat;
      autoFormat: boolean;
    },
    key?: string,
  ): Promise<string> {
    const id = input.id ?? rid();
    const endpoint = input.endpoint.trim().replace(/\/+$/, "");
    const luno = isLunoEndpoint(endpoint);

    const list = this.stored().slice();
    const existing = list.find((p) => p.id === id);
    const next: StoredProvider = {
      id,
      label: input.label.trim() || "Custom",
      kind: luno ? "luno" : "custom",
      endpoint,
      // Per-model overrides and the last test survive an edit; format fields
      // only apply to custom endpoints.
      ...(luno ? {} : { format: input.format, autoFormat: input.autoFormat }),
      ...(existing?.modelFormats ? { modelFormats: existing.modelFormats } : {}),
      ...(existing?.lastTest ? { lastTest: existing.lastTest } : {}),
    };
    const idx = list.findIndex((p) => p.id === id);
    if (idx >= 0) list[idx] = next;
    else list.push(next);

    await this.config.update("providers", list);
    if (key !== undefined) await this.setKey(id, key);
    return id;
  }

  async remove(id: string): Promise<void> {
    if (id === LUNO_ID) return; // built-in, not removable
    await this.config.update(
      "providers",
      this.stored().filter((p) => p.id !== id),
    );
    await this.context.secrets.delete(KEY_PREFIX + id);
  }

  /** Set (or clear, when format is omitted) a per-model format override. */
  async setModelFormat(
    providerId: string,
    modelId: string,
    format?: ProviderFormat,
  ): Promise<void> {
    const list = this.stored().slice();
    const idx = list.findIndex((p) => p.id === providerId);
    if (idx < 0) return; // built-in luno without an override entry: always claude-code
    const overrides = { ...(list[idx].modelFormats ?? {}) };
    if (format) overrides[modelId] = format;
    else delete overrides[modelId];
    list[idx] = {
      ...list[idx],
      modelFormats: Object.keys(overrides).length ? overrides : undefined,
    };
    await this.config.update("providers", list);
  }

  /**
   * Run a connection test against one provider and persist the outcome so the
   * provider list shows it across reloads. The built-in Luno provider is
   * testable too; when it has no stored entry the result is kept in memory.
   */
  async test(id: string): Promise<ProviderTestResult> {
    const provider = await this.get(id);
    if (!provider) throw new Error(`Unknown provider: ${id}`);

    const target: ProviderTarget = {
      id: provider.id,
      endpoint: provider.endpoint,
      kind: provider.kind,
      // Provider-level format is enough for a probe; per-model overrides only
      // matter once an actual model is called.
      format:
        provider.kind === "luno"
          ? "claude-code"
          : provider.format ?? "openai-v1",
      // The built-in provider rides the account session key; stored/custom
      // providers use their own Secret Storage entry.
      key:
        provider.builtin && provider.kind === "luno"
          ? this.accountKey() ?? (await this.getKey(id))
          : await this.getKey(id),
    };
    const result = await this.gateway.testProvider(target);

    const list = this.stored().slice();
    const idx = list.findIndex((p) => p.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], lastTest: result };
      await this.config.update("providers", list); // fires via the relay
    } else {
      // Built-in luno with no stored override — nothing to persist into.
      this.lunoTest = result;
      this._onDidChange.fire();
    }
    return result;
  }

  /**
   * Effective wire format for one model of a provider. Precedence:
   * luno kind (always claude-code, informational) → per-model override →
   * brand inference when autoFormat is on → provider-level format →
   * openai-v1 as the universal fallback.
   */
  formatForModel(provider: Provider, modelId: string): ProviderFormat {
    if (provider.kind === "luno") return "claude-code";
    const override = provider.modelFormats?.[modelId];
    if (override) return override;
    if (provider.autoFormat) {
      const brand = inferModelBrand(modelId);
      if (brand === "anthropic") return "claude-code";
      if (brand === "openai") return "codex";
      return "openai-v1";
    }
    return provider.format ?? "openai-v1";
  }
}

function rid(): string {
  return randomUUID();
}
