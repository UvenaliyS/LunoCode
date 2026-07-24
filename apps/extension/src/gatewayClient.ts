import type {
  AccountProfile,
  ChatAttachment,
  DeviceCodeStart,
  DeviceCodePollStatus,
  ModelInfo,
  PlanId,
  ProviderFormat,
  ProviderKind,
  ProviderTestResult,
  ToolName,
  UsageSnapshot,
} from "./types";
import { inferModelBrand } from "./types";
import type { PlannedStep } from "./agentRunner";
import { TOOL_SCHEMAS, OPENAI_TOOL_SCHEMAS, CODEX_TOOL_SCHEMAS } from "./toolSchemas";

/**
 * Executes one tool the model asked for (native tool_use) and returns the
 * text result. Injected by the controller — it owns the AgentRunner (approval
 * gate, SSH bridge, workspace fs). `isError` lets a failed tool feed back to
 * the model as a tool_result with is_error:true instead of aborting the turn.
 */
export type ToolExecutor = (
  name: ToolName,
  input: Record<string, unknown>,
  toolUseId: string,
) => Promise<{ output: string; isError?: boolean }>;

/** A native tool_use block emitted by the model mid-stream. */
interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Where to send a models/chat request, resolved from a Provider + its key. */
export interface ProviderTarget {
  id: string;
  endpoint: string;
  kind: ProviderKind;
  /** Wire format the endpoint speaks — decides URL, headers and SSE parsing.
   *  For kind "luno" this is informational (the luno contract always applies). */
  format: ProviderFormat;
  key?: string;
}

/** Chat request body shared by every format; each dispatcher reshapes it. */
export interface ChatBody {
  model: string;
  messages: { role: string; content: string }[];
  system?: string;
  /** Images/PDFs riding with the LAST user message as real content blocks. */
  attachments?: ChatAttachment[];
}

/** Split a data: URL into its media type and base64 payload. */
function parseDataUrl(
  dataUrl: string,
): { mime: string; data: string } | undefined {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mime: m[1], data: m[2] } : undefined;
}

/** Rewrite the last user message into a content-block array carrying its text
 *  plus attachments in pick order: images/PDFs as native Anthropic blocks,
 *  text files as a labelled text block (path + size + line count + contents) —
 *  the "second layer" note telling the model the user attached this file.
 *  Mutates in place. Shared by streamClaude and streamClaudeAgentic. */
function attachToLastUser(
  messages: { role: string; content: unknown }[],
  attachments?: ChatAttachment[],
): void {
  if (!attachments?.length) return;
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return;
  const blocks: unknown[] = [{ type: "text", text: String(last.content) }];
  for (const att of attachments) {
    if (att.kind === "file") {
      blocks.push({ type: "text", text: fileAttachmentText(att) });
      continue;
    }
    const parsed = att.dataUrl ? parseDataUrl(att.dataUrl) : undefined;
    if (!parsed) continue;
    blocks.push(
      att.kind === "pdf"
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: parsed.data,
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: parsed.mime,
              data: parsed.data,
            },
          },
    );
  }
  last.content = blocks;
}

/** Text-file attachment → the labelled block body (shared across formats). */
function fileAttachmentText(att: ChatAttachment): string {
  const kb = att.bytes != null ? `${Math.max(1, Math.round(att.bytes / 1024))} KB` : "?";
  return (
    `<attached-file path="${att.path ?? att.name}" lines="${att.lines ?? "?"}" size="${kb}">\n` +
    `The user attached this file to the message.\n\n${att.text ?? ""}\n</attached-file>`
  );
}

/** Attach images to the last user message in OpenAI Chat Completions content
 *  parts (image_url). Text files ride as text parts; PDFs aren't a Chat
 *  Completions block — noted in text. */
function attachOpenAIImages(
  messages: Record<string, unknown>[],
  attachments?: ChatAttachment[],
): void {
  if (!attachments?.length) return;
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return;
  const parts: unknown[] = [{ type: "text", text: String(last.content) }];
  const pdfs: string[] = [];
  for (const att of attachments) {
    if (att.kind === "image" && att.dataUrl) {
      parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
    } else if (att.kind === "file") {
      parts.push({ type: "text", text: fileAttachmentText(att) });
    } else {
      pdfs.push(att.name);
    }
  }
  if (pdfs.length) {
    parts[0] = {
      type: "text",
      text: `${String(last.content)}\n\n(Attached PDFs not supported by this provider format: ${pdfs.join(", ")})`,
    };
  }
  last.content = parts;
}

/** Attach images to the last user item in the Responses `input` list. */
function attachCodexImages(
  input: Record<string, unknown>[],
  attachments?: ChatAttachment[],
): void {
  if (!attachments?.length) return;
  const last = [...input].reverse().find((m) => m.role === "user");
  if (!last || !Array.isArray(last.content)) return;
  for (const att of attachments) {
    if (att.kind === "file") {
      (last.content as unknown[]).push({
        type: "input_text",
        text: fileAttachmentText(att),
      });
      continue;
    }
    if (!att.dataUrl) continue;
    (last.content as unknown[]).push(
      att.kind === "pdf"
        ? { type: "input_file", filename: att.name, file_data: att.dataUrl }
        : { type: "input_image", image_url: att.dataUrl },
    );
  }
}

/** Anthropic requires a version header on every /v1/messages call. */
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * HTTP client for Luno and custom providers.
 *
 * Auth + billing (device-code, key verify, OAuth, usage) always target the
 * built-in Luno gateway via `baseUrl`/`apiKey`. Models and chat are
 * provider-targeted: each request carries a ProviderTarget whose kind/format
 * selects the wire protocol — the luno gateway contract, Anthropic Messages
 * (claude-code), OpenAI Responses (codex) or OpenAI Chat Completions
 * (openai-v1).
 */
export class GatewayClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string,
  ) {}

  /** Fired when the gateway rejects our Luno key (401/403) — the AuthManager
   *  wires this to a logout so a revoked key drops the account cleanly. */
  private onAuthInvalid?: () => void;

  setAuthInvalidHandler(fn: () => void): void {
    this.onAuthInvalid = fn;
  }

  setApiKey(key: string | undefined): void {
    this.apiKey = key;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  private lunoHeaders(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    // Absolute URLs pass through; bare paths are relative to the gateway base.
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.lunoHeaders(), ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      // A key that the gateway rejects (revoked/expired) must drop the session
      // — only when WE sent a key (an anonymous 401 is just "sign in first").
      if ((res.status === 401 || res.status === 403) && this.apiKey) {
        this.onAuthInvalid?.();
      }
      const body = await res.text().catch(() => "");
      // Never leak an HTML error page (nginx/Caddy 404s etc.) into UI error
      // strings — "<!doctype html>…" reads as garbage in banners/tooltips.
      // Prefer a JSON error/message field; otherwise short plain text only.
      let detail = "";
      const trimmed = body.trim();
      if (trimmed && !/^\s*</.test(trimmed)) {
        try {
          const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
          detail = String(parsed.error ?? parsed.message ?? "").slice(0, 200);
        } catch {
          detail = trimmed.slice(0, 200);
        }
      }
      throw new Error(
        detail
          ? `Gateway ${res.status} ${res.statusText}: ${detail}`
          : `Gateway ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Base with a guaranteed /v1 suffix — users paste the gateway URL both
   *  with and without it. All account/usage endpoints live under /v1. */
  private v1(): string {
    const b = this.baseUrl.replace(/\/+$/, "");
    return /\/v1$/i.test(b) ? b : `${b}/v1`;
  }

  // --- Auth ------------------------------------------------------------------

  /** Device-code flow is not implemented by the production gateway (yet) —
   *  callers must catch the failure and fall back to API-key sign-in. */
  startDeviceCode(): Promise<DeviceCodeStart> {
    return this.json<DeviceCodeStart>("/auth/device/start", { method: "POST" });
  }

  pollDeviceCode(deviceCode: string): Promise<DeviceCodePollStatus> {
    return this.json<DeviceCodePollStatus>("/auth/device/poll", {
      method: "POST",
      body: JSON.stringify({ deviceCode }),
    });
  }

  /** Validate an API key pasted from the dashboard (luno.codes → API Keys).
   *  A key is valid iff GET /v1/me accepts it; the profile carries the plan. */
  async verifyKey(apiKey: string): Promise<{ valid: boolean; plan?: PlanId }> {
    const res = await fetch(`${this.v1()}/me`, {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey.trim()}`,
      },
    });
    if (!res.ok) return { valid: false };
    const profile = (await res.json()) as AccountProfile;
    return { valid: true, plan: profile.plan as PlanId | undefined };
  }

  /** Exchange a browser-OAuth one-time token (from the vscode:// callback). */
  oauthExchange(token: string): Promise<{ apiKey: string; plan: PlanId }> {
    return this.json("/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  /** Signed-in profile (name/email/avatar/plan) from the gateway. */
  getProfile(): Promise<AccountProfile> {
    return this.json<AccountProfile>(`${this.v1()}/me`);
  }

  getUsage(): Promise<UsageSnapshot> {
    return this.json<UsageSnapshot>(`${this.v1()}/usage`);
  }

  /**
   * Generate a short chat title from the user's first message — mirrors the
   * Luno webchat/CLI title path: a tiny non-streamed /v1/messages call with
   * its own tight system prompt, fired IN PARALLEL with the answer (the
   * caller races it, we never block the turn). Best-effort; returns undefined
   * on any failure or a NO_TITLE answer so the caller keeps its fallback.
   */
  async generateTitle(
    firstMessage: string,
    model: string,
  ): Promise<string | undefined> {
    const text = firstMessage.trim();
    if (!text) return undefined;
    try {
      const res = await fetch(`${this.v1()}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": ANTHROPIC_VERSION,
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          stream: false,
          system: [
            {
              type: "text",
              text:
                "You are a title generator. Output ONLY a short topic title (2-5 words) for the conversation that starts with the user message. Use the SAME language as the user. Plain text ONLY — no markdown, no asterisks, no quotes, no punctuation at the ends. Never explain, never comment, never address the user. If the message is only a greeting, small talk, or a test with no real topic yet (e.g. \"привет\", \"hi\", \"тест\"), output exactly NO_TITLE and nothing else.",
            },
          ],
          messages: [
            {
              role: "user",
              content: `Generate a title for this conversation:\n\n${text.slice(0, 2000)}`,
            },
          ],
        }),
      });
      if (!res.ok) return undefined;
      const data = (await res.json()) as {
        content?: { type?: string; text?: string }[];
      };
      const raw = (data.content ?? [])
        .filter((b) => b?.type === "text")
        .map((b) => b.text ?? "")
        .join(" ")
        .trim();
      // Strip stray markdown/quotes the model may still add; cap length.
      const clean = raw
        .replace(/[*_`"']/g, "")
        .replace(/\s+/g, " ")
        .trim();
      // NO_TITLE = the model judged there's no topic yet — keep the fallback.
      if (!clean || /\bNO_TITLE\b/i.test(clean)) return undefined;
      // A real title is a few words. A long sentence means the model went
      // meta ("Кажется, разговор только начался…") — reject it so the caller
      // keeps the fallback and retries on a later turn.
      if (clean.split(" ").length > 8) return undefined;
      return clean.slice(0, 60);
    } catch {
      return undefined;
    }
  }

  // --- Models (provider-targeted) --------------------------------------------

  /**
   * List models for one provider. Luno endpoints speak the gateway contract
   * ({models, nonLogging}); custom endpoints may answer in OpenAI, Anthropic
   * or a bare {models: []} shape — all three are accepted. `formatFor` lets
   * the caller stamp each model with its effective format (per-model override
   * / autoFormat), falling back to the provider-level format.
   */
  async listModels(
    target: ProviderTarget,
    formatFor?: (modelId: string) => ProviderFormat,
  ): Promise<{ models: ModelInfo[]; nonLogging: boolean }> {
    const res = await this.fetchModels(target);
    if (!res.ok) throw new Error(`Models ${res.status}`);

    if (target.kind === "luno") {
      // The production gateway answers in the OpenAI list shape
      // ({object:'list', data:[{id}]}); older/self-hosted gateways may answer
      // {models:[...]} — accept both.
      const raw = (await res.json()) as {
        data?: { id: string; display_name?: string }[];
        models?: ModelInfo[];
        nonLogging?: boolean;
      };
      const entries = raw.models ?? raw.data ?? [];
      const models = dedupeAndSortModels(entries
          .filter((m) => typeof m?.id === "string")
          // Drop reasoning-effort variants the gateway advertises as separate
          // ids (…-low/-medium/-high/-xhigh/-max). Effort is a per-request knob
          // the picker adds; listing them as models just clutters the menu with
          // near-duplicates.
          .filter((m) => !isEffortVariant(m.id))
          .map((m) => {
            const id = canonicalModelId(m.id);
            return {
            id,
            label: (m as ModelInfo).label ?? prettyModelLabel(id),
            sonnetEq: (m as ModelInfo).sonnetEq ?? sonnetEqOf(id),
            providerId: target.id,
            brand: inferModelBrand(id),
            // Informational: the luno gateway serves the Claude Code environment.
            format: "claude-code" as const,
          }}));
      return {
        models,
        // The Luno gateway's own no-logging policy; not claimed for others.
        nonLogging: raw.nonLogging ?? true,
      };
    }

    // Custom: OpenAI {data:[{id}]}, Anthropic {data:[{id,display_name}]} and
    // bare {models:[{id,label?}]} all reduce to one entry list.
    const raw = (await res.json()) as {
      data?: { id: string; display_name?: string; label?: string }[];
      models?: { id: string; display_name?: string; label?: string }[];
    };
    const entries = raw.data ?? raw.models ?? [];
    const normalizeIds = isMicrosoftFoundryEndpoint(target.endpoint);
    const models: ModelInfo[] = dedupeAndSortModels(entries
      .filter((m) => typeof m?.id === "string")
      // Foundry's data-plane /models is a broad catalogue, not a list of
      // deployments. It currently advertises synthetic/unreleased Claude ids
      // (for example Fable 5 and Sonnet 5.2) that always 404 at inference.
      // Keep them out of the picker; real custom deployment names can still be
      // added explicitly in Settings → Models.
      .filter((m) => !isBogusFoundryClaudeId(m.id))
      .map((m) => {
        const id = normalizeIds ? canonicalModelId(m.id) : m.id;
        return {
        id,
        // Prefer a server-supplied display name; otherwise prettify the id so
        // custom providers don't show raw "claude-opus-4-8" / "gpt-5.5".
        label: m.display_name ?? m.label ?? prettyModelLabel(id),
        sonnetEq: 1, // custom endpoints don't report cost weights
        providerId: target.id,
        brand: inferModelBrand(id),
        format: formatFor?.(id) ?? target.format,
      };
      }));
    // Only the Luno gateway can guarantee non-logging; never claim it for
    // arbitrary endpoints.
    return { models, nonLogging: false };
  }

  /**
   * GET the models endpoint for a target. Luno: {base}/models. Custom: users
   * paste endpoints both with and without /v1, so we try {vbase}/models first
   * and fall back to plain {base}/models on 404 (some self-hosted gateways
   * serve models at the root).
   */
  private async fetchModels(
    target: ProviderTarget,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers = targetHeaders(target);
    if (target.kind === "luno") {
      return fetch(`${vbaseOf(target)}/models`, { headers, signal });
    }
    if (isMicrosoftFoundryEndpoint(target.endpoint)) {
      return fetch(foundryModelsUrl(target), { headers, signal });
    }
    const vurl = `${vbaseOf(target)}/models`;
    const plain = `${baseOf(target)}/models`;
    const res = await fetch(vurl, { headers, signal });
    if (res.status === 404 && plain !== vurl) {
      return fetch(plain, { headers, signal });
    }
    return res;
  }

  // --- Connection test --------------------------------------------------------

  /**
   * Probe a provider by listing its models (cheapest authenticated call every
   * format supports). Distinguishes bad keys from unreachable hosts so the
   * provider list can show an actionable error.
   */
  async testProvider(target: ProviderTarget): Promise<ProviderTestResult> {
    const started = Date.now();
    try {
      // 8s budget: long enough for a cold serverless endpoint, short enough
      // that the settings UI never feels hung.
      const res = await this.fetchModels(target, AbortSignal.timeout(8000));
      const latencyMs = Date.now() - started;
      if (res.ok) {
        let modelCount: number | undefined;
        try {
          const raw = (await res.json()) as {
            data?: unknown[];
            models?: unknown[];
          };
          const list = raw.data ?? raw.models;
          if (Array.isArray(list)) modelCount = list.length;
        } catch {
          // A non-JSON 2xx still proves the endpoint is reachable.
        }
        return {
          ok: true,
          modelCount,
          status: res.status,
          latencyMs,
          testedAt: Date.now(),
        };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: "Invalid API key",
          status: res.status,
          latencyMs,
          testedAt: Date.now(),
        };
      }
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        status: res.status,
        latencyMs,
        testedAt: Date.now(),
      };
    } catch (e) {
      const latencyMs = Date.now() - started;
      const aborted =
        e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError");
      return {
        ok: false,
        error: aborted ? "Timed out" : "Unreachable",
        latencyMs,
        testedAt: Date.now(),
      };
    }
  }

  // --- Agent (plan of observable steps) --------------------------------------

  /**
   * Ask the provider for an agent plan: an ordered list of steps (thinking /
   * tool calls) to execute for the prompt. Only the Luno gateway exposes this
   * endpoint; the custom-format agent loop (native tool calls over
   * claude-code/codex/openai-v1) lands later, so custom providers return an
   * empty plan and the turn falls back to a chat reply.
   */
  async planAgent(
    target: ProviderTarget,
    body: { model: string; prompt: string },
  ): Promise<PlannedStep[]> {
    if (target.kind !== "luno") return [];
    const res = await fetch(`${baseOf(target)}/agent/plan`, {
      method: "POST",
      headers: targetHeaders(target),
      body: JSON.stringify(body),
    });
    // The production gateway doesn't serve /agent/plan (yet) — an empty plan
    // makes the turn fall back to a plain chat reply, same as custom providers.
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Agent plan ${res.status}`);
    const data = (await res.json()) as { steps?: PlannedStep[] };
    return data.steps ?? [];
  }

  // --- Chat (streamed, provider-targeted) -------------------------------------

  /**
   * Stream a chat completion from the given provider. Calls onChunk for each
   * text delta; resolves with the Sonnet-eq cost (0 for formats that don't
   * report it — only the luno contract does).
   */
  async streamChat(
    target: ProviderTarget,
    body: ChatBody,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{ sonnetEqCost: number }> {
    if (target.kind === "luno") {
      // The production Luno gateway speaks the standard wire formats, not a
      // bespoke /chat contract: Claude models go over Anthropic Messages
      // (/v1/messages — the same battle-tested path Claude Code CLI uses),
      // everything else over OpenAI Chat Completions (/v1/chat/completions).
      return inferModelBrand(body.model) === "anthropic"
        ? this.streamClaude(target, body, onChunk, signal)
        : this.streamOpenAI(target, body, onChunk, signal);
    }
    switch (target.format) {
      case "claude-code":
        return this.streamClaude(target, body, onChunk, signal);
      case "codex":
        return this.streamCodex(target, body, onChunk, signal);
      default:
        // openai-v1 — also the safest fallback should an unknown format ever
        // leak in from a hand-edited config file.
        return this.streamOpenAI(target, body, onChunk, signal);
    }
  }

  /** Anthropic Messages: POST {vbase}/messages, event-typed SSE. */
  private async streamClaude(
    target: ProviderTarget,
    body: ChatBody,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{ sonnetEqCost: number }> {
    // Anthropic rejects role "system" inside messages — it travels in the
    // top-level `system` field instead.
    const messages: { role: string; content: unknown }[] = body.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content as unknown }));

    // Attachments ride on the last user message: images/PDFs as native
    // Messages-API blocks, text files as labelled text blocks.
    attachToLastUser(messages, body.attachments);

    const payload: Record<string, unknown> = {
      model: body.model,
      // Messages API demands max_tokens; 8192 is a safe ceiling every current
      // Claude model accepts.
      max_tokens: 8192,
      stream: true,
      messages,
    };
    if (body.system) payload.system = body.system;

    const reader = await openStream(
      messagesUrl(target),
      targetHeaders(target),
      payload,
      signal,
    );
    await readSse(reader, (data) => {
      try {
        const evt = JSON.parse(data) as {
          type?: string;
          delta?: { text?: unknown };
        };
        if (evt.type === "content_block_delta") {
          const text = evt.delta?.text;
          if (typeof text === "string" && text) onChunk(text);
        }
        return evt.type === "message_stop";
      } catch {
        return false;
      }
    });
    return { sonnetEqCost: 0 };
  }

  /**
   * Agentic Claude turn: native Anthropic tool-use loop over /v1/messages, the
   * same wire shape Claude Code CLI uses. Sends the built-in tool schemas so the
   * model can call tools; each `tool_use` the model emits is executed via
   * `exec` and fed back as a `tool_result`, looping until the model finishes
   * (stop_reason !== "tool_use"). onChunk streams assistant text; onThinking
   * streams reasoning; onToolUse / onToolResult drive the step UI.
   *
   * The gateway (claudeCodeShape) impersonates the real CLI: it injects the CC
   * system prompt, a stable per-session device_id (metadata.user_id) and the CC
   * headers — so upstream treats this exactly like the official client. We do
   * NOT send our own system prompt as the primary one; it rides as extra
   * context only (title-gen uses a separate path).
   */
  async streamClaudeAgentic(
    target: ProviderTarget,
    body: ChatBody,
    exec: ToolExecutor,
    hooks: {
      onChunk: (delta: string) => void;
      onThinking?: (delta: string) => void;
      onToolUse?: (block: ToolUseBlock) => void;
      onToolResult?: (id: string, output: string, isError: boolean) => void;
    },
    signal?: AbortSignal,
    maxRounds = 12,
  ): Promise<{ sonnetEqCost: number }> {
    // Seed history from the caller's plain messages (+ attachments on the last
    // user turn, same as streamClaude). Content becomes block arrays as the
    // loop appends assistant tool_use / user tool_result turns.
    const messages: { role: string; content: unknown }[] = body.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content as unknown }));
    attachToLastUser(messages, body.attachments);

    for (let round = 0; round < maxRounds; round++) {
      if (signal?.aborted) break;

      const payload: Record<string, unknown> = {
        model: body.model,
        max_tokens: 8192,
        stream: true,
        messages,
        tools: TOOL_SCHEMAS,
      };
      if (body.system) payload.system = body.system;

      const reader = await openStream(
        messagesUrl(target),
        targetHeaders(target),
        payload,
        signal,
      );

      // Accumulate the assistant turn's content blocks as they stream in, so we
      // can replay the exact turn (text + tool_use) back into history.
      const blocks: unknown[] = [];
      const toolUses: ToolUseBlock[] = [];
      let curText = "";
      let curToolJson = "";
      let curBlockType: string | undefined;
      let curToolMeta: { id: string; name: string } | undefined;
      let stopReason: string | undefined;

      await readSse(reader, (data) => {
        try {
          const evt = JSON.parse(data) as any;
          switch (evt.type) {
            case "content_block_start": {
              const b = evt.content_block;
              curBlockType = b?.type;
              if (b?.type === "text") {
                curText = "";
              } else if (b?.type === "thinking") {
                // reasoning follows in deltas
              } else if (b?.type === "tool_use") {
                curToolJson = "";
                curToolMeta = { id: String(b.id), name: String(b.name) };
              }
              break;
            }
            case "content_block_delta": {
              const d = evt.delta;
              if (d?.type === "text_delta" && typeof d.text === "string") {
                curText += d.text;
                hooks.onChunk(d.text);
              } else if (
                d?.type === "thinking_delta" &&
                typeof d.thinking === "string"
              ) {
                hooks.onThinking?.(d.thinking);
              } else if (
                d?.type === "input_json_delta" &&
                typeof d.partial_json === "string"
              ) {
                curToolJson += d.partial_json;
              }
              break;
            }
            case "content_block_stop": {
              if (curBlockType === "text" && curText) {
                blocks.push({ type: "text", text: curText });
              } else if (curBlockType === "tool_use" && curToolMeta) {
                let input: Record<string, unknown> = {};
                try {
                  input = curToolJson ? JSON.parse(curToolJson) : {};
                } catch {
                  input = {};
                }
                const block: ToolUseBlock = { ...curToolMeta, input };
                blocks.push({
                  type: "tool_use",
                  id: block.id,
                  name: block.name,
                  input,
                });
                toolUses.push(block);
                hooks.onToolUse?.(block);
              }
              curBlockType = undefined;
              curToolMeta = undefined;
              break;
            }
            case "message_delta": {
              if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
              break;
            }
            case "message_stop":
              return true;
          }
        } catch {
          // Tolerate keepalive / comment frames.
        }
        return false;
      });

      // Persist the assistant turn (text + any tool_use blocks) into history.
      if (blocks.length) messages.push({ role: "assistant", content: blocks });

      // No tools requested → the turn is done.
      if (stopReason !== "tool_use" || toolUses.length === 0) {
        return { sonnetEqCost: 0 };
      }

      // Execute each requested tool and feed the results back as a single
      // user turn of tool_result blocks (Anthropic's required shape).
      const results: unknown[] = [];
      for (const use of toolUses) {
        if (signal?.aborted) break;
        let output = "";
        let isError = false;
        try {
          const r = await exec(
            use.name as ToolName,
            use.input,
            use.id,
          );
          output = r.output;
          isError = !!r.isError;
        } catch (e) {
          output = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        hooks.onToolResult?.(use.id, output, isError);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: output || "(no output)",
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
      // Loop: the model sees the tool results and continues.
    }
    return { sonnetEqCost: 0 };
  }

  /**
   * OpenAI Chat Completions agentic loop (openai-v1 format). Same tool set as
   * Claude Code, wrapped in the OpenAI `tools` shape; the model emits
   * `tool_calls` in the streamed delta, we execute them via `exec`, feed the
   * results back as role:"tool" messages, and loop until the model stops
   * requesting tools. Names match the Anthropic path so AgentRunner runs them
   * identically.
   */
  async streamOpenAIAgentic(
    target: ProviderTarget,
    body: ChatBody,
    exec: ToolExecutor,
    hooks: {
      onChunk: (delta: string) => void;
      onToolUse?: (block: ToolUseBlock) => void;
      onToolResult?: (id: string, output: string, isError: boolean) => void;
    },
    signal?: AbortSignal,
    maxRounds = 12,
  ): Promise<{ sonnetEqCost: number }> {
    // Seed history: a top-level system message, then the turn history.
    const messages: Record<string, unknown>[] = [];
    if (body.system) messages.push({ role: "system", content: body.system });
    for (const m of body.messages) messages.push({ role: m.role, content: m.content });
    // Attach images to the last user message (OpenAI vision content parts).
    attachOpenAIImages(messages, body.attachments);

    for (let round = 0; round < maxRounds; round++) {
      if (signal?.aborted) break;

      const reader = await openStream(
        `${vbaseOf(target)}/chat/completions`,
        targetHeaders(target),
        {
          model: body.model,
          messages,
          stream: true,
          tools: OPENAI_TOOL_SCHEMAS,
        },
        signal,
      );

      // Accumulate streamed tool_calls (they arrive fragmented across deltas,
      // keyed by index) plus any assistant text.
      const toolAcc = new Map<
        number,
        { id: string; name: string; args: string }
      >();
      let text = "";
      let finishReason: string | undefined;

      await readSse(reader, (data) => {
        if (data === "[DONE]") return true;
        try {
          const evt = JSON.parse(data) as {
            choices?: {
              delta?: {
                content?: unknown;
                tool_calls?: {
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
              finish_reason?: string;
            }[];
          };
          const choice = evt.choices?.[0];
          const delta = choice?.delta;
          if (typeof delta?.content === "string" && delta.content) {
            text += delta.content;
            hooks.onChunk(delta.content);
          }
          for (const tc of delta?.tool_calls ?? []) {
            const cur =
              toolAcc.get(tc.index) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(tc.index, cur);
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        } catch {
          // Tolerate keepalive/comment frames.
        }
        return false;
      });

      // No tools requested → the turn is done.
      if (finishReason !== "tool_calls" || toolAcc.size === 0) {
        return { sonnetEqCost: 0 };
      }

      // Record the assistant turn (text + tool_calls) so the follow-up carries
      // the required tool_call ids.
      const calls = [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, c]) => c);
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args || "{}" },
        })),
      });

      // Execute each tool and append its result as a role:"tool" message.
      for (const c of calls) {
        if (signal?.aborted) break;
        let input: Record<string, unknown> = {};
        try {
          input = c.args ? JSON.parse(c.args) : {};
        } catch {
          input = {};
        }
        hooks.onToolUse?.({ id: c.id, name: c.name, input });
        let output = "";
        let isError = false;
        try {
          const r = await exec(c.name as ToolName, input, c.id);
          output = r.output;
          isError = !!r.isError;
        } catch (e) {
          output = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        hooks.onToolResult?.(c.id, output, isError);
        messages.push({
          role: "tool",
          tool_call_id: c.id,
          content: output || "(no output)",
        });
      }
    }
    return { sonnetEqCost: 0 };
  }

  /**
   * OpenAI Responses agentic loop (codex format). Same tool set; the model
   * emits function_call items, we execute them and feed function_call_output
   * back. Names match Claude Code so AgentRunner runs them identically.
   */
  async streamCodexAgentic(
    target: ProviderTarget,
    body: ChatBody,
    exec: ToolExecutor,
    hooks: {
      onChunk: (delta: string) => void;
      onToolUse?: (block: ToolUseBlock) => void;
      onToolResult?: (id: string, output: string, isError: boolean) => void;
    },
    signal?: AbortSignal,
    maxRounds = 12,
  ): Promise<{ sonnetEqCost: number }> {
    // Responses keeps a flat `input` list of typed items.
    const input: Record<string, unknown>[] = body.messages.map((m) => ({
      role: m.role,
      content: [
        {
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: m.content,
        },
      ],
    }));
    attachCodexImages(input, body.attachments);

    for (let round = 0; round < maxRounds; round++) {
      if (signal?.aborted) break;

      const payload: Record<string, unknown> = {
        model: body.model,
        stream: true,
        input,
        tools: CODEX_TOOL_SCHEMAS,
      };
      if (body.system) payload.instructions = body.system;

      const reader = await openStream(
        `${vbaseOf(target)}/responses`,
        targetHeaders(target),
        payload,
        signal,
      );

      // Collect function_call items as they complete.
      const calls: { id: string; callId: string; name: string; args: string }[] =
        [];
      const partial = new Map<string, { name: string; args: string }>();
      let sawFunctionCall = false;

      await readSse(reader, (data) => {
        try {
          const evt = JSON.parse(data) as any;
          switch (evt.type) {
            case "response.output_text.delta":
              if (typeof evt.delta === "string" && evt.delta)
                hooks.onChunk(evt.delta);
              break;
            case "response.output_item.added":
              if (evt.item?.type === "function_call") {
                sawFunctionCall = true;
                partial.set(evt.item.id, {
                  name: evt.item.name ?? "",
                  args: evt.item.arguments ?? "",
                });
              }
              break;
            case "response.function_call_arguments.delta":
              if (evt.item_id) {
                const p = partial.get(evt.item_id) ?? { name: "", args: "" };
                p.args += evt.delta ?? "";
                partial.set(evt.item_id, p);
              }
              break;
            case "response.output_item.done":
              if (evt.item?.type === "function_call") {
                const p = partial.get(evt.item.id) ?? {
                  name: evt.item.name ?? "",
                  args: evt.item.arguments ?? "",
                };
                calls.push({
                  id: evt.item.id,
                  callId: evt.item.call_id ?? evt.item.id,
                  name: p.name || evt.item.name || "",
                  args: p.args || evt.item.arguments || "",
                });
              }
              break;
            case "response.completed":
              return true;
          }
        } catch {
          // Tolerate keepalive/comment frames.
        }
        return false;
      });

      if (!sawFunctionCall || calls.length === 0) {
        return { sonnetEqCost: 0 };
      }

      // Append each function_call and its output to the running input list.
      for (const c of calls) {
        if (signal?.aborted) break;
        input.push({
          type: "function_call",
          call_id: c.callId,
          name: c.name,
          arguments: c.args || "{}",
        });
        let parsed: Record<string, unknown> = {};
        try {
          parsed = c.args ? JSON.parse(c.args) : {};
        } catch {
          parsed = {};
        }
        hooks.onToolUse?.({ id: c.callId, name: c.name, input: parsed });
        let output = "";
        let isError = false;
        try {
          const r = await exec(c.name as ToolName, parsed, c.callId);
          output = r.output;
          isError = !!r.isError;
        } catch (e) {
          output = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        hooks.onToolResult?.(c.callId, output, isError);
        input.push({
          type: "function_call_output",
          call_id: c.callId,
          output: output || "(no output)",
        });
      }
    }
    return { sonnetEqCost: 0 };
  }

  /** OpenAI Responses (Codex): POST {vbase}/responses, event-typed SSE. */
  private async streamCodex(
    target: ProviderTarget,
    body: ChatBody,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{ sonnetEqCost: number }> {
    // Responses wraps each message's text in a typed content part; the part
    // type differs by side (model output vs our input).
    const input = body.messages.map((m) => ({
      role: m.role,
      content: [
        {
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: m.content,
        },
      ] as unknown[],
    }));

    // Images/PDFs ride the last user item as input_image/input_file parts;
    // text files as input_text blocks.
    attachCodexImages(input as unknown as Record<string, unknown>[], body.attachments);

    const payload: Record<string, unknown> = {
      model: body.model,
      stream: true,
      input,
    };
    if (body.system) payload.instructions = body.system;

    const reader = await openStream(
      `${vbaseOf(target)}/responses`,
      targetHeaders(target),
      payload,
      signal,
    );
    await readSse(reader, (data) => {
      try {
        const evt = JSON.parse(data) as { type?: string; delta?: unknown };
        if (evt.type === "response.output_text.delta") {
          if (typeof evt.delta === "string" && evt.delta) onChunk(evt.delta);
        }
        return evt.type === "response.completed";
      } catch {
        return false;
      }
    });
    return { sonnetEqCost: 0 };
  }

  /** OpenAI Chat Completions: POST {vbase}/chat/completions. */
  private async streamOpenAI(
    target: ProviderTarget,
    body: ChatBody,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{ sonnetEqCost: number }> {
    // Chat Completions has no top-level system field — prepend it as a
    // system message so the instruction isn't silently dropped.
    const messages: { role: string; content: unknown }[] = (
      body.system
        ? [{ role: "system", content: body.system }, ...body.messages]
        : [...body.messages]
    ).map((m) => ({ role: m.role, content: m.content as unknown }));

    // Images as image_url parts (OpenAI vision shape); text files as text
    // parts; PDFs noted in text (no Chat Completions block for them).
    attachOpenAIImages(messages as unknown as Record<string, unknown>[], body.attachments);

    const reader = await openStream(
      `${vbaseOf(target)}/chat/completions`,
      targetHeaders(target),
      { model: body.model, messages, stream: true },
      signal,
    );
    await readSse(reader, (data) => {
      if (data === "[DONE]") return true;
      try {
        const evt = JSON.parse(data) as {
          choices?: { delta?: { content?: unknown } }[];
        };
        const delta = evt.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) onChunk(delta);
      } catch {
        // Tolerate keepalive/comment frames.
      }
      return false;
    });
    return { sonnetEqCost: 0 };
  }
}

// ---------------------------------------------------------------------------
// Target URL / header helpers
// ---------------------------------------------------------------------------

/** Endpoint without trailing slashes. */
function baseOf(target: ProviderTarget): string {
  return target.endpoint
    .replace(/\/+$/, "")
    // People commonly copy the full endpoint shown by Foundry rather than
    // its API base. Normalize those leaf routes before appending our route.
    .replace(/\/(?:responses|chat\/completions|messages|models)$/i, "");
}

/** "claude-sonnet-4.6" → "Claude Sonnet 4.6" — readable picker labels for the
 *  bare ids the production /v1/models endpoint returns. */
/** "claude-sonnet-4.6" → "Sonnet 4.6" — readable picker labels for the bare
 *  ids the production /v1/models endpoint returns. The "Claude" brand word is
 *  intentionally dropped: the UI renders a brand icon + prefix, so keeping it
 *  in the label produces "Claude Claude Sonnet 4.6". */
/** Turn a raw model id into a readable label. Handles the shapes every
 *  provider throws at us:
 *    claude-opus-4-8            → "Claude Opus 4.8"
 *    claude-haiku-4-5-20251001  → "Claude Haiku 4.5"   (date suffix dropped)
 *    claude-sonnet-4-6          → "Claude Sonnet 4.6"
 *    gpt-5.6-luna               → "GPT-5.6 Luna"
 *    gpt-5.5 / gpt-4o           → "GPT-5.5" / "GPT-4o"
 *    gemini-2.5-flash           → "Gemini 2.5 Flash"
 *  Version segments split as separate dash parts (…-4-8) are re-joined with a
 *  dot; a trailing 8-digit date (…-20251001) is stripped. */
function prettyModelLabel(id: string): string {
  let s = id.trim();
  // Drop a trailing date stamp: -20251001 or -2025-10-01.
  s = s.replace(/[-_]\d{8}$/i, "").replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}$/i, "");
  // Merge dash/underscore-split version numbers: "4-8" → "4.8", "4-5" → "4.5".
  s = s.replace(/(\d)[-_](\d)/g, "$1.$2");

  const CANON: Record<string, string> = {
    gpt: "GPT",
    glm: "GLM",
    claude: "Claude",
    gemini: "Gemini",
    grok: "Grok",
    opus: "Opus",
    sonnet: "Sonnet",
    haiku: "Haiku",
    fable: "Fable",
    llama: "Llama",
    mistral: "Mistral",
    deepseek: "DeepSeek",
    qwen: "Qwen",
  };
  const cap = (w: string): string => {
    const lower = w.toLowerCase();
    if (CANON[lower]) return CANON[lower];
    // Keep tokens that already contain a version/number as-is (4o, 5.6, v2).
    if (/\d/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  };

  // "gpt-5.6" and the like read best hyphenated (GPT-5.6); everything else is
  // space-separated. Split on dash/underscore, canonicalise each token.
  const parts = s.split(/[-_]/).filter(Boolean).map(cap);
  if (parts.length === 0) return id;
  // GPT / GLM families keep the brand glued to the version: "GPT-5.6 Luna".
  if ((parts[0] === "GPT" || parts[0] === "GLM") && parts.length >= 2 && /\d/.test(parts[1])) {
    const head = `${parts[0]}-${parts[1]}`;
    return [head, ...parts.slice(2)].join(" ");
  }
  return parts.join(" ");
}

/** True for reasoning-effort model ids the gateway lists separately
 *  (…-low / -medium / -high / -xhigh / -max). Effort is applied per request,
 *  not chosen as a distinct model. */
function isEffortVariant(id: string): boolean {
  return /-(low|medium|high|xhigh|max)$/i.test(id);
}

/** Foundry advertises version ids even though /responses expects the alias. */
function canonicalModelId(id: string): string {
  return id
    .replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}(?=$|[-_])/i, "")
    .replace(/[-_]\d{8}(?=$|[-_])/i, "");
}

function isMicrosoftFoundryEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return (
      host.endsWith(".services.ai.azure.com") ||
      host.endsWith(".openai.azure.com") ||
      host.endsWith(".models.ai.azure.com")
    );
  } catch {
    return false;
  }
}

const MODEL_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function modelSortBucket(id: string): number {
  const s = id.toLowerCase();
  if (/claude|anthropic|opus|sonnet|haiku|fable/.test(s)) return 0;
  if (/^gpt-|^o\d|openai|codex|davinci/.test(s)) return 1;
  if (/grok|xai/.test(s)) return 2;
  if (/deepseek/.test(s)) return 3;
  if (/gemini|google|palm/.test(s)) return 4;
  if (/kimi|moonshot/.test(s)) return 5;
  if (/mistral|mixtral|ministral/.test(s)) return 6;
  if (/llama|meta/.test(s)) return 7;
  if (/phi|mai-|microsoft/.test(s)) return 8;
  if (/qwen/.test(s)) return 9;
  if (/cohere|command-r/.test(s)) return 10;
  return 20;
}

function modelTier(id: string): number {
  const s = id.toLowerCase();
  if (/fable|opus|speciale|pro|max|ultra|large|maverick/.test(s)) return 0;
  if (/sonnet|reasoning|thinking|medium/.test(s)) return 1;
  if (/flash|mini|small|scout|lite/.test(s)) return 3;
  if (/nano|haiku/.test(s)) return 4;
  return 2;
}

function modelFamilyRank(id: string): number {
  const s = id.toLowerCase();
  if (/^gpt-\d/.test(s)) return 0;
  if (/^o\d/.test(s)) return 1;
  if (/codex/.test(s)) return 2;
  if (/^gpt-(chat|realtime|audio|image)/.test(s)) return 3;
  if (/^gpt-oss/.test(s)) return 4;
  return 0;
}

function modelVersion(id: string): number {
  const s = id.toLowerCase();
  const match =
    s.match(/(?:gpt|claude-(?:fable|opus|sonnet|haiku)|grok|deepseek-v|gemini|kimi-k|mistral)[-_]?(\d+)(?:[.-](\d+))?/) ??
    s.match(/^o(\d+)(?:[.-](\d+))?/);
  if (!match) return 0;
  return Number(match[1]) + Number(match[2] ?? 0) / 100;
}

function compareModels(a: ModelInfo, b: ModelInfo): number {
  const bucket = modelSortBucket(a.id) - modelSortBucket(b.id);
  if (bucket) return bucket;
  const family = modelFamilyRank(a.id) - modelFamilyRank(b.id);
  if (family) return family;
  const versionNumber = modelVersion(b.id) - modelVersion(a.id);
  if (versionNumber) return versionNumber;
  const tier = modelTier(a.id) - modelTier(b.id);
  if (tier) return tier;
  const version = MODEL_COLLATOR.compare(b.id, a.id);
  if (version) return version;
  return 0;
}

function dedupeAndSortModels(models: ModelInfo[]): ModelInfo[] {
  const unique = new Map<string, ModelInfo>();
  for (const model of models) {
    const key = model.id.toLowerCase();
    const current = unique.get(key);
    if (!current || model.label.length < current.label.length) {
      unique.set(key, model);
    }
  }
  return [...unique.values()].sort(compareModels);
}

/** Sonnet-equivalent cost multiplier per model family — mirrors the gateway's
 *  quota weights (Sonnet money basis: sonnet 1.0 / opus 1.67 / fable 3.33). */
function sonnetEqOf(id: string): number {
  const m = id.toLowerCase();
  if (m.includes("fable")) return 3.33;
  if (m.includes("opus")) return 1.67;
  if (m.includes("haiku")) return 0.33;
  return 1;
}

/** Versioned base: users paste endpoints both with and without /v1, so append
 *  it only when it isn't already the last path segment. */
function vbaseOf(target: ProviderTarget): string {
  const base = baseOf(target);
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

/**
 * Anthropic Messages URL with Azure Foundry normalization.
 *
 * Users copy endpoints at every level: resource root, /openai/v1,
 * /anthropic, /anthropic/v1, or the full /v1/messages URI. Claude on Foundry
 * always lives on the services.ai hostname at /anthropic/v1/messages, while
 * OpenAI-compatible models remain on /openai/v1. Route by wire format so one
 * provider can serve both catalogues.
 */
function messagesUrl(target: ProviderTarget): string {
  if (!isMicrosoftFoundryEndpoint(target.endpoint)) {
    return `${vbaseOf(target)}/messages`;
  }
  try {
    const url = new URL(target.endpoint);
    url.hostname = url.hostname.replace(
      /\.openai\.azure\.com$/i,
      ".services.ai.azure.com",
    );
    url.pathname = "/anthropic/v1/messages";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return `${vbaseOf(target)}/messages`;
  }
}

/** Azure catalogue URL, independent of whichever inference leaf was pasted. */
function foundryModelsUrl(target: ProviderTarget): string {
  try {
    const url = new URL(target.endpoint);
    url.pathname = "/openai/v1/models";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return `${vbaseOf(target)}/models`;
  }
}

/** Known catalogue-only Claude ids that are not callable deployments. */
function isBogusFoundryClaudeId(id: string): boolean {
  const s = canonicalModelId(id).toLowerCase();
  return (
    /claude-fable/.test(s) ||
    new Set([
      "claude-sonnet-5",
      "claude-sonnet-5-2",
      "claude-opus-4-8-2",
      "claude-haiku-4-5-2",
    ]).has(s)
  );
}

/** Auth headers per format. Anthropic's own API wants x-api-key + a version
 *  header; OpenAI-style proxies (and many Anthropic-compatible gateways like
 *  coda.ink) want Authorization: Bearer. We can't know which a custom endpoint
 *  is, so for claude-code we send BOTH — the server uses whichever it accepts
 *  and ignores the other. Everything else takes Bearer. */
function targetHeaders(target: ProviderTarget): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (target.kind === "custom" && target.format === "claude-code") {
    h["anthropic-version"] = ANTHROPIC_VERSION;
    if (target.key) {
      h["x-api-key"] = target.key;
      h["authorization"] = `Bearer ${target.key}`;
    }
  } else if (target.key) {
    h["authorization"] = `Bearer ${target.key}`;
  }
  return h;
}

// ---------------------------------------------------------------------------
// SSE plumbing shared by every streaming format
// ---------------------------------------------------------------------------

/** POST a streaming request and hand back the body reader, or throw a
 *  readable error ("Chat <status>: <server message>") on non-2xx. */
async function openStream(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const maxRetries = 3;
  let lastDetail = "";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    if (res.ok && res.body) return res.body.getReader();

    const text = (await res.text().catch(() => "")).trim();
    // Prefer the structured error message every format nests under
    // error.message; fall back to the raw body.
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } };
      if (typeof parsed?.error?.message === "string" && parsed.error.message) {
        detail = parsed.error.message;
      }
    } catch {
      // Keep the raw body.
    }
    lastDetail = detail;
    lastStatus = res.status;

    // Retry transient 5xx (upstream busy / capacity) with exponential backoff —
    // the gateway rotates keys server-side, so a quick retry often lands on a
    // free slot. 4xx are permanent (bad request / auth) — fail immediately.
    if (res.status >= 500 && attempt < maxRetries && !signal?.aborted) {
      const backoff = Math.min(4000, 600 * 2 ** (attempt - 1)); // 600ms, 1.2s
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    break;
  }
  // Overload / capacity errors read as gibberish to a user — normalise to a
  // short, friendly message. Everything else surfaces its real detail.
  const isOverload =
    lastStatus >= 500 ||
    /container instance|max_instances|overload|too many concurrent|capacity|temporarily unavailable|busy/i.test(
      lastDetail,
    );
  const message = isOverload
    ? "The service is busy right now. Please try again in a moment."
    : `Chat ${lastStatus}: ${lastDetail}`;
  throw new Error(message);
}

/**
 * Read an SSE stream line by line, invoking onFrame with each `data:` payload.
 * Buffers partial lines across chunks, tolerates \r\n, ignores comments and
 * event-name lines. onFrame returning true stops reading (terminal event).
 */
async function readSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onFrame: (data: string) => boolean,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string): boolean => {
    const trimmed = line.trim(); // also drops the \r of \r\n framing
    if (!trimmed.startsWith("data:")) return false;
    const data = trimmed.slice(5).trim();
    if (!data) return false;
    return onFrame(data);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (handleLine(line)) {
        // Terminal event seen — release the connection instead of draining it.
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }
  // Flush a final unterminated line (servers that omit the trailing newline).
  if (buffer) handleLine(buffer);
}
