/**
 * Shared contracts for Luno Code Studio.
 *
 * These types are the single source of truth for messages crossing process
 * boundaries: extension host <-> webview, and extension <-> gateway.
 */

// ---------------------------------------------------------------------------
// Plans & billing (spec §1, §4)
// ---------------------------------------------------------------------------

export type PlanId = "STARTER" | "PLUS" | "POWER" | "DEV";

export interface PlanLimits {
  /** Sonnet-equivalent units allotted per 5-hour rolling window. */
  fiveHourLimit: number;
  /** Sonnet-equivalent units allotted per week. */
  weeklyLimit: number;
  /** Sonnet-equivalent units allotted for the whole subscription period. */
  totalLimit: number;
  /** Max parallel in-flight requests. */
  concurrency: number;
  /** Queue priority multiplier (x1..x8). */
  priority: number;
}

/** A single rate-limit window's usage, for the usage popover. */
export interface UsageBucket {
  /** Stable key for rendering/logic. */
  id: "fiveHour" | "weekly" | "total";
  /** Short label, e.g. "5-hour", "Weekly", "Subscription". */
  label: string;
  /** Sonnet-eq used in this window. */
  used: number;
  /** Sonnet-eq allotted for this window. */
  limit: number;
  /** Unix ms when this window resets (omitted for the subscription total). */
  resetAt?: number;
}

export interface UsageSnapshot {
  plan: PlanId;
  limits: PlanLimits;
  /** The three rate-limit windows: 5-hour, weekly, subscription total. */
  buckets: UsageBucket[];
  /** Overview extras (site dashboard parity) — absent on older gateways. */
  bonusBalance?: number;
  rpmLimit?: number;
  requestsToday?: number;
  requestsMonth?: number;
}

// ---------------------------------------------------------------------------
// Models (spec §3)
// ---------------------------------------------------------------------------

/** Model brand, inferred from the model id/label. Drives icons + grouping. */
export type ModelBrand = "anthropic" | "openai" | "google" | "xai" | "other";

export interface ModelInfo {
  id: string;
  label: string;
  /** Cost multiplier relative to Sonnet (Sonnet = 1). */
  sonnetEq: number;
  /** Which provider serves this model (defaults to "luno"). */
  providerId?: string;
  /** Brand inferred from the id (claude/gpt/gemini/grok), for icons. */
  brand?: ModelBrand;
  /** Effective wire format this model is called with (after auto/override). */
  format?: ProviderFormat;
}

/** Infer the brand from a model id/label. Single source of truth. */
export function inferModelBrand(idOrLabel: string): ModelBrand {
  const s = idOrLabel.toLowerCase();
  if (/(claude|opus|sonnet|haiku|fable|anthropic)/.test(s)) return "anthropic";
  if (/(gpt|openai|o1|o3|o4|codex|davinci)/.test(s)) return "openai";
  if (/(gemini|google|palm|bard)/.test(s)) return "google";
  if (/(grok|xai)/.test(s)) return "xai";
  return "other";
}

// ---------------------------------------------------------------------------
// Providers (multi-API: Luno + user-supplied custom endpoints)
// ---------------------------------------------------------------------------

/**
 * Wire format a provider speaks. This decides the request/response shape,
 * the tool environment and the streaming protocol:
 *   claude-code — Anthropic Messages (/v1/messages SSE) with the Claude Code
 *                 tool environment (Bash/Read/Write/Edit/…).
 *   codex       — OpenAI Responses (/v1/responses SSE) with the Codex
 *                 environment and its tools.
 *   openai-v1   — universal OpenAI Chat Completions (/v1/chat/completions);
 *                 tool loop shaped like Claude Code where possible.
 */
export type ProviderFormat = "claude-code" | "codex" | "openai-v1";

/**
 * Provider kind:
 *   luno   — the Luno gateway contract (/models, /chat SSE, /usage). Applied
 *            automatically when the endpoint host is a luno.codes domain.
 *   custom — any user-added endpoint, speaking one of ProviderFormat.
 */
export type ProviderKind = "luno" | "custom";

/** Result of the connection test run when a provider is added/edited. */
export interface ProviderTestResult {
  /** Overall verdict. */
  ok: boolean;
  /** Round-trip latency of the probe, ms. */
  latencyMs?: number;
  /** HTTP status the probe returned (200, 401, …). */
  status?: number;
  /** Number of models the endpoint reported, when the probe listed models. */
  modelCount?: number;
  /** Human-readable failure ("Invalid API key", "Timed out", …). */
  error?: string;
  /** Unix ms when the test ran. */
  testedAt: number;
}

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Base URL of the API. */
  endpoint: string;
  /** Wire format for custom providers. Luno providers always speak luno. */
  format?: ProviderFormat;
  /** Auto-pick the format per model id (claude-* → claude-code, gpt-* and
   *  codex → codex, else openai-v1). When false, `format` applies to every
   *  model. */
  autoFormat?: boolean;
  /** Per-model format overrides (model id → format), set from Settings. */
  modelFormats?: Record<string, ProviderFormat>;
  /** Whether an API key is stored (in Secret Storage) — the key itself is
   *  never sent to the webview. */
  hasKey?: boolean;
  /** True for the built-in Luno provider (can't be deleted). */
  builtin?: boolean;
  /** Last connection-test outcome, shown in the provider list. */
  lastTest?: ProviderTestResult;
}

/** Hosts that identify a custom endpoint as the Luno API. */
export const LUNO_HOST_RE = /(^|\.)luno\.codes$/i;

/** True when the endpoint URL points at the Luno API (any subdomain, with or
 *  without /v1 path) — such providers auto-register as kind "luno". */
export function isLunoEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return LUNO_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

/** Sonnet-equivalent coefficients from the spec (§3). */
export const SONNET_EQ: Record<string, number> = {
  "claude-haiku": 0.3,
  "claude-sonnet": 1,
  "claude-opus": 5,
  "gpt-4o": 1,
  "gemini-flash": 0.2,
};

// ---------------------------------------------------------------------------
// Auth (spec §1)
// ---------------------------------------------------------------------------

export interface DeviceCodeStart {
  /** Short human-readable code the user confirms in @LunoBot or the web LK. */
  userCode: string;
  /** Opaque token the client polls with. */
  deviceCode: string;
  /** Deep link to open the Telegram bot. */
  verificationUri: string;
  /** Link to confirm the code in the web personal cabinet (studio.luno.codes). */
  webVerificationUri: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Seconds the client should wait between polls. */
  interval: number;
}

export type DeviceCodePollStatus =
  | { status: "pending" }
  | { status: "approved"; apiKey: string; plan: PlanId }
  | { status: "expired" }
  | { status: "denied" };

/** The signed-in account, as the personal cabinet reports it (GET /account/me).
 *  `avatar` is the site's generated-avatar token ("luno:<palette>:<icon>") —
 *  rendered identically in the extension, so the profile looks the same. */
export interface AccountProfile {
  name?: string;
  email?: string;
  avatar?: string | null;
  plan?: string;
  /** Unix ms when the current plan expires, if the plan is time-boxed. */
  planExpiresAt?: number;
}

// ---------------------------------------------------------------------------
// Chat (spec §2)
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant" | "system";

/**
 * A binary attachment that travels with a prompt as a real content block.
 * Images and PDFs are the two kinds Claude accepts directly; other files are
 * referenced by path instead (the host inlines their text — see readContext).
 */
export interface ChatAttachment {
  kind: "image" | "pdf" | "file";
  name: string;
  /** data: URL (base64) — image/pdf only; never written to disk or logs. */
  dataUrl?: string;
  /** Extracted text — kind "file" only; rides the user turn as a text block. */
  text?: string;
  /** Workspace-relative (or absolute) source path, shown to the model. */
  path?: string;
  /** Raw byte size, when known — drives the size line on file cards. */
  bytes?: number;
  /** Line count for text-ish files, when known — shown as a corner badge. */
  lines?: number;
}

// ---------------------------------------------------------------------------
// Agent mode: observable execution (spec — agents with visible steps/tools)
// ---------------------------------------------------------------------------

/** Whether a turn is a plain chat reply or an agentic run with tools. */
export type ChatMode = "chat" | "agent";

/** Tools the agent can invoke. Read tools run freely; write/exec are gated.
 *  We speak the REAL Claude Code CLI tool names (Bash, Read, Write, Edit, Glob,
 *  Grep, …) so the gateway's Claude-Code impersonation matches its captured
 *  system prompt and the webview can render each with its proper icon/style. */
export type ToolName =
  | "Bash"
  | "BashOutput"
  | "KillShell"
  | "Read"
  | "Write"
  | "Edit"
  | "MultiEdit"
  | "Glob"
  | "Grep"
  | "LS"
  | "WebFetch"
  | "WebSearch"
  | "TodoWrite"
  | "Task"
  | "AskUserQuestion"
  | "Skill"
  | "SlashCommand"
  | "NotebookEdit"
  | "ExitPlanMode"
  | "EnterPlanMode"
  // local runner dialect (legacy — kept so old sessions/custom providers work):
  | "readFile"
  | "listDir"
  | "writeFile"
  | "applyEdit"
  | "runCommand"
  // SSH subsystem (creds never reach the model — see docs/SSH_TOOLS.md):
  | "sshList"
  | "sshExec"
  | "sshAdd"
  | "sshPick";

/** Tools that mutate the workspace or run code — subject to the approval gate. */
export const MUTATING_TOOLS: ToolName[] = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "writeFile",
  "applyEdit",
  "runCommand",
  "sshExec",
];

export type StepStatus = "running" | "done" | "error" | "rejected";

/** A single tool invocation within an agent step. */
export interface ToolCall {
  name: ToolName;
  /** Human-readable target, e.g. a path or command, for the collapsed header. */
  title: string;
  /** Raw input arguments (path/content/command), shown when expanded. */
  input: Record<string, unknown>;
  /** Streamed/!final output text (command stdout, file contents, …). */
  output?: string;
  /** For applyEdit/writeFile: a unified diff to preview and approve. */
  diff?: string;
  /** Absolute-ish workspace path the call touched, for file tools. */
  path?: string;
  /** TodoWrite — the plan checklist. */
  todos?: TodoItem[];
  /** ExitPlanMode/EnterPlanMode — the proposed plan (markdown). */
  plan?: string;
  /** AskUserQuestion — a question with selectable options. */
  question?: {
    header?: string;
    prompt: string;
    options: AskOption[];
  };
  /** sshExec/sshPick — servers involved, for the header/cards (never creds). */
  sshServers?: SshServerMeta[];
  /** sshPick — whether multiple servers may be selected. */
  sshMulti?: boolean;
}

/** A single todo item for the TodoWrite tool card. */
export interface TodoItem {
  text: string;
  status: "pending" | "active" | "done";
}

/** One selectable option in an AskUserQuestion card. */
export interface AskOption {
  label: string;
  description?: string;
  recommended?: boolean;
  /** Optional preview content shown when the option is selected (monospace). */
  preview?: string;
}

/**
 * One observable step in an agent run. Either the model "thinking" (a narration
 * line) or a tool call with live status. Rendered as a collapsible block in the
 * chat feed, mirroring the Claude Code GUI.
 */
export interface AgentStep {
  id: string;
  kind: "thinking" | "tool";
  status: StepStatus;
  /** Collapsed one-line summary. */
  title: string;
  /** Present when kind === "tool". */
  tool?: ToolCall;
  /** Error text when status === "error". */
  error?: string;
}

/** How mutating tools are gated. */
export type ApprovalMode = "ask" | "auto";

/**
 * One block in an assistant turn's chronological feed. The model interleaves
 * prose and tool calls; blocks preserve that exact order so the UI renders a
 * single timeline (text, then the tool it triggered, then the next text…)
 * instead of hoisting all tools above all text.
 */
export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "step"; stepId: string };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Set while an assistant message is still streaming. */
  streaming?: boolean;
  /** Model used, for cost display. */
  model?: string;
  /** Sonnet-eq cost of this turn, once known. */
  sonnetEqCost?: number;
  /** Wall-clock time the assistant turn took, ms (persists after streaming). */
  elapsedMs?: number;
  /** True when the user stopped this turn mid-stream (renders a divider). */
  stopped?: boolean;
  /** Observable agent steps for this turn (agent mode only). */
  steps?: AgentStep[];
  /** Chronological feed of text + tool-step references, in emission order. */
  blocks?: MessageBlock[];
  /** Binary attachments (images/PDFs) sent with a user message, for preview. */
  attachments?: ChatAttachment[];
  /** Context file paths referenced by a user message, for preview. */
  contextPaths?: string[];
}

/** A persisted chat session. Stored locally (VS Code globalState). */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Model selected when the session was last active. */
  model?: string;
  /** True once the user renamed it, so auto-titling stops overwriting. */
  titleEdited?: boolean;
  messages: ChatMessage[];
}

/** Lightweight session descriptor for the history list (no message bodies). */
export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  /** Number of messages, for the list subtitle. */
  messageCount: number;
  /** First user prompt, truncated, for a preview line. */
  preview: string;
}

// ---------------------------------------------------------------------------
// SSH subsystem — servers the agent can reach WITHOUT ever seeing credentials
// ---------------------------------------------------------------------------

/** How a server authenticates. The secret itself lives in OS Secret Storage. */
export type SshAuthMethod = "password" | "privateKey";

/**
 * What the MODEL (and the webview list) sees about an SSH server. Credentials
 * are stored separately in Secret Storage keyed by the server id and are only
 * used inside the extension host when executing a command.
 */
export interface SshServerMeta {
  /** Stable uuid, assigned on add. */
  id: string;
  /** User-supplied display name (required). */
  name: string;
  /** Host/IP the model may see and reason about. */
  host: string;
  /** SSH port (default 22). */
  port: number;
  /** Login user. */
  username: string;
  /** Auth method — password or private key (the value is never exposed). */
  auth: SshAuthMethod;
  /** Unix ms when the server was added. */
  createdAt: number;
}

/** Payload for adding/updating a server. Secret travels host-side only:
 *  webview -> extension in one message, stored, never echoed back. */
export interface SshServerInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  auth: SshAuthMethod;
  /** Password or private-key text, depending on auth. Omit on edit to keep. */
  secret?: string;
  /** Optional key passphrase (privateKey auth only). */
  passphrase?: string;
}

/** Result of an SSH connectivity probe (on add / test button). */
export interface SshTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  testedAt: number;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationSettings {
  /** Master switch. */
  enabled: boolean;
  /** Toast + sound when a long agent run finishes. */
  onComplete: boolean;
  /** Toast + sound when the agent is blocked waiting for approval. */
  onApproval: boolean;
  /** Toast + sound on errors (stream failures, tool errors). */
  onError: boolean;
  /** Play a soft sound with the above events. */
  sound: boolean;
  /** OS-level banner when the VS Code window is not focused. */
  osBanner: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  onComplete: true,
  onApproval: true,
  onError: true,
  sound: true,
  osBanner: false,
};

/** Fine-grained auto-approval — which tool classes skip the approval gate while
 *  in "ask" mode. Only consulted when approvalMode === "ask" ("auto" approves
 *  everything). See MUTATING_TOOLS / agentRunner.shouldAutoApprove. */
export interface AutoApproveSettings {
  /** readFile/listDir — already non-mutating; the flag is for UI completeness. */
  readFiles: boolean;
  /** writeFile. */
  writeFiles: boolean;
  /** applyEdit. */
  applyEdits: boolean;
  /** runCommand — ANY shell command. */
  runCommands: boolean;
  /** sshExec. */
  sshCommands: boolean;
  /** Command prefixes auto-approved even when runCommands is off (e.g. "npm test"). */
  allowedCommands: string[];
  /** Auto-approvals allowed in a row before the gate re-engages (0 = unlimited). */
  maxAutoApprovals: number;
}

export const DEFAULT_AUTO_APPROVE: AutoApproveSettings = {
  readFiles: true,
  writeFiles: false,
  applyEdits: false,
  runCommands: false,
  sshCommands: false,
  // Read-only shell commands that can't mutate anything — safe to run without a
  // prompt so the agent can orient itself (pwd/ls/cat/git status/…).
  allowedCommands: [
    "pwd",
    "ls",
    "cat",
    "echo",
    "which",
    "git status",
    "git log",
    "git diff",
    "git branch",
  ],
  maxAutoApprovals: 0,
};

/** Context-window management for long conversations. */
export interface ContextSettings {
  /** Summarize the oldest turns once the window fills past the threshold. */
  autoCompact: boolean;
  /** Compact when estimated tokens exceed this % of the model window (20–100). */
  compactThresholdPct: number;
  /** Permanently drop stale tool outputs from history (cache-safe: outputs live
   *  on steps, which never enter the streamed prefix). */
  pruneOldOutputs: boolean;
  /** Per-file cap (KB) when reading attached context files. */
  maxFileSizeKb: number;
  /** Always-on instructions prepended to the system prompt (like project rules). */
  customInstructions: string;
}

export const DEFAULT_CONTEXT: ContextSettings = {
  autoCompact: true,
  compactThresholdPct: 80,
  pruneOldOutputs: true,
  maxFileSizeKb: 20,
  customInstructions: "",
};

// ---------------------------------------------------------------------------
// Remote control (Telegram WebApp) — phone paired to this extension instance
// ---------------------------------------------------------------------------

/** What a paired device may touch: one workspace or the whole extension. */
export type RemoteScope = "project" | "system";

/** A phone (Telegram WebApp) paired to this extension instance. */
export interface RemoteDevice {
  /** Stable uuid minted by the relay at claim time. */
  id: string;
  /** Display label, e.g. "@username" or the Telegram first name. */
  label: string;
  /** Telegram numeric user id — shown so the user can spot a stranger. */
  tgId: number;
  scope: RemoteScope;
  /** Project-scope only: fingerprint of the workspace recorded at pairing. */
  workspaceHash?: string;
  /** Project-scope only: folder name recorded at pairing, for the error text. */
  workspaceName?: string;
  createdAt: number;
  lastSeenAt?: number;
}

/** Remote bridge status, rendered in the Remote settings tab. */
export interface RemoteStatus {
  enabled: boolean;
  serverUrl: string;
  /** True while the bridge's socket to the relay is open. */
  connected: boolean;
  devices: RemoteDevice[];
  /** Active pairing code, while one is outstanding. */
  pairing?: { code: string; expiresAt: number };
}

/** Remote settings persisted in luno.json. */
export interface RemoteSettings {
  enabled: boolean;
  /** Relay origin, wss:// (the /ws/ext path is appended by the bridge). */
  serverUrl: string;
}

export const DEFAULT_REMOTE: RemoteSettings = {
  enabled: false,
  // The dedicated WS hostname (Cloudflare-proxied) — the UI/REST host
  // webapp.luno.codes sits behind Fastly, which cannot proxy WS upgrades.
  serverUrl: "wss://webapp-events.luno.codes",
};

/** Chat/webview rendering preferences. */
export interface DisplaySettings {
  /** Whole-webview zoom factor (0.8–1.4). */
  uiScale: number;
  /** Chat text (messages + markdown) font scale (0.8–1.5), independent of uiScale. */
  fontScale: number;
  /** Start agent "thinking" blocks collapsed. */
  collapseThinking: boolean;
  /** Start tool-call output collapsed. */
  collapseToolOutput: boolean;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  uiScale: 1,
  fontScale: 1,
  collapseThinking: false,
  collapseToolOutput: false,
};

// ---------------------------------------------------------------------------
// Webview <-> Extension messaging
// ---------------------------------------------------------------------------

export type ViewKind = "chat" | "settings" | "history";

/** Settings tab ids — used for deep-linking (e.g. sshAdd → SSH tab). */
export type SettingsTabId =
  | "general"
  | "providers"
  | "models"
  | "agent"
  | "autoApprove"
  | "display"
  | "context"
  | "ssh"
  | "remote"
  | "app"
  | "notifications"
  | "account"
  | "experimental"
  | "language"
  | "about";

export type ConnState = "unknown" | "online" | "offline";

export interface LunoSettings {
  gatewayUrl: string;
  defaultModel: string;
  streamResponses: boolean;
  showSonnetEqCost: boolean;
  /** How the agent gates mutating tools (writeFile/applyEdit/runCommand). */
  approvalMode: ApprovalMode;
  /** Inject the SSH subsystem prompt + tools into agent runs (default on).
   *  Applies to Luno and custom providers alike. */
  sshEnabled: boolean;
  /** Notification behavior. */
  notifications: NotificationSettings;
  /** Fine-grained auto-approval (consulted only in "ask" mode). */
  autoApprove: AutoApproveSettings;
  /** Context-window management. */
  context: ContextSettings;
  /** Chat/webview rendering preferences. */
  display: DisplaySettings;
  /** Remote control (Telegram WebApp) bridge. */
  remote: RemoteSettings;
  /** UI language — "auto" follows the VS Code display language. */
  language: "auto" | "en" | "ru";
}

/** How the user is linking their account. */
export type LinkChannel = "telegram" | "web";

/** Messages sent FROM the webview TO the extension host. */
export type WebviewToExtension =
  | { type: "ready" }
  | {
      type: "sendPrompt";
      text: string;
      model?: string;
      mode?: ChatMode;
      contextPaths?: string[];
      attachments?: ChatAttachment[];
    }
  | { type: "stop" }
  | { type: "newChat" }
  /** Persist the composer draft for a chat (sessionId undefined = the unsaved
   *  fresh chat). Survives chat switches and VS Code restarts. */
  | {
      type: "saveDraft";
      sessionId?: string;
      text: string;
      attachments?: ChatAttachment[];
      contextPaths?: string[];
    }
  | { type: "login"; channel?: LinkChannel }
  | { type: "submitKey"; key: string }
  | { type: "startOAuth" }
  | { type: "cancelLink" }
  | { type: "logout" }
  | { type: "selectModel"; model: string }
  | { type: "buyReset" }
  | { type: "openBilling" }
  | { type: "openSettings"; tab?: SettingsTabId }
  | { type: "updateSetting"; key: keyof LunoSettings; value: unknown }
  | { type: "testConnection" }
  | { type: "reload" }
  /** Open the single Luno JSON config file for hand-editing. */
  | { type: "openConfigFile" }
  /** Export settings (JSON) to a user-picked file. Secrets excluded. */
  | { type: "exportConfig" }
  /** Import settings from a user-picked JSON file (validated, merged). */
  | { type: "importConfig" }
  /** Ask for the session list (history view opened). */
  | { type: "listSessions" }
  /** Load a saved session into the active chat. */
  | { type: "loadSession"; id: string }
  /** Delete a saved session. */
  | { type: "deleteSession"; id: string }
  /** Rename a saved session. */
  | { type: "renameSession"; id: string; title: string }
  /** Ask for the provider list (Connect panel opened). */
  | { type: "listProviders" }
  /** Add a custom provider. Triggers an immediate connection test; the
   *  result comes back via `providerTest`. */
  | {
      type: "addProvider";
      label: string;
      endpoint: string;
      format: ProviderFormat;
      autoFormat: boolean;
      key?: string;
    }
  /** Update an existing provider (key omitted = leave unchanged). */
  | {
      type: "updateProvider";
      id: string;
      label: string;
      endpoint: string;
      format: ProviderFormat;
      autoFormat: boolean;
      key?: string;
    }
  /** Remove a custom provider. */
  | { type: "deleteProvider"; id: string }
  /** Re-run the connection test for one provider. */
  | { type: "testProvider"; id: string }
  /** Set a per-model format override (format omitted = clear override). */
  | { type: "setModelFormat"; providerId: string; modelId: string; format?: ProviderFormat }
  /** Approve or reject a gated (mutating) tool call the agent is waiting on. */
  | {
      type: "approveToolCall";
      stepId: string;
      approved: boolean;
      /** When set, persist this command pattern to the auto-approve allow-list
       *  before resolving — the "Always allow …" action. */
      allowPattern?: string;
    }
  /** Open a workspace file picker to add files to the prompt context. */
  | { type: "addContext" }
  // --- SSH subsystem ---
  /** Ask for the SSH server list (SSH settings tab / agent cards). */
  | { type: "sshList" }
  /** Add or update a server. Secret goes straight to Secret Storage. */
  | { type: "sshUpsert"; server: SshServerInput }
  /** Delete a server (and its stored secret). */
  | { type: "sshDelete"; id: string }
  /** Probe a server (connect + trivial exec), result via `sshTest`. */
  | { type: "sshTest"; id: string }
  /** Resolve an interactive sshAdd step: user added a server (or cancelled).
   *  When they picked the new server right on the card, serverId rides along
   *  so the agent can proceed without a separate sshPick round-trip. */
  | { type: "sshAddResolve"; stepId: string; added: boolean; serverId?: string }
  /** Resolve an interactive sshPick step with the chosen server ids. */
  | { type: "sshPickResolve"; stepId: string; serverIds: string[] }
  // --- Remote control (Telegram WebApp) ---
  /** Remote settings tab mounted — wants the current bridge status. */
  | { type: "remoteStatus" }
  /** Toggle the remote bridge on/off (also persisted via updateSetting). */
  | { type: "remoteSetEnabled"; enabled: boolean }
  /** Generate a fresh pairing code (rendered as text + QR). */
  | { type: "remoteNewPairCode" }
  /** Unpair a device — kills its sockets and wipes its token. */
  | { type: "remoteRevoke"; deviceId: string };

/** Messages sent FROM the extension host TO the webview. */
export type ExtensionToWebview =
  | { type: "state"; state: WebviewState }
  | { type: "messageAppend"; message: ChatMessage }
  | { type: "messageChunk"; id: string; delta: string }
  | { type: "messageThinking"; id: string; delta: string }
  | { type: "messageDone"; id: string; sonnetEqCost?: number; elapsedMs?: number; stopped?: boolean }
  | { type: "usage"; usage: UsageSnapshot }
  | { type: "conn"; conn: ConnState }
  | { type: "error"; message: string }
  /** Switch which screen the webview renders, in-place. */
  | { type: "navigate"; view: ViewKind; settingsTab?: SettingsTabId }
  /** Pop the composer's branded usage panel (status-bar click). */
  | { type: "showUsagePopover" }
  /** A device-code link attempt started — render code + QR and wait. */
  | {
      type: "linkChallenge";
      channel: LinkChannel;
      userCode: string;
      verificationUri: string;
      webVerificationUri: string;
    }
  /** A link attempt finished (approved, denied, expired, or cancelled). */
  | { type: "linkResult"; ok: boolean; error?: string }
  /** The saved-session list, for the history view. */
  | { type: "sessions"; sessions: ChatSessionMeta[]; activeId?: string }
  /** The provider list, for the Connect panel. */
  | { type: "providers"; providers: Provider[] }
  /** A provider connection test finished (fired on add/edit/test). */
  | { type: "providerTest"; providerId: string; result: ProviderTestResult }
  /** Config export/import finished. */
  | { type: "configTransfer"; op: "export" | "import"; ok: boolean; detail?: string }
  /** A new agent step began (append it to the current assistant message). */
  | { type: "agentStep"; messageId: string; step: AgentStep }
  /** An existing step changed (status, streamed output, diff, error). */
  | {
      type: "agentStepUpdate";
      messageId: string;
      stepId: string;
      patch: Partial<AgentStep>;
    }
  /** Append streamed output text to a tool step (stdout, file read, …). */
  | { type: "agentStepOutput"; messageId: string; stepId: string; delta: string }
  /** The agent is blocked waiting for approval of a mutating tool call. */
  | { type: "toolApprovalRequest"; messageId: string; stepId: string }
  /** Files the user picked to add to the prompt context. */
  | { type: "contextAdded"; paths: string[] }
  /** Binary attachments (images/PDFs) picked via the host file dialog. */
  | { type: "attachmentsAdded"; attachments: ChatAttachment[] }
  /** The send failed before anything streamed — put the full input (text +
   *  attachments + context) back into the composer so nothing is lost or
   *  double-sent. */
  | {
      type: "restoreInput";
      text: string;
      attachments?: ChatAttachment[];
      contextPaths?: string[];
    }
  // --- SSH subsystem ---
  /** The SSH server list (metadata only — never credentials). */
  | { type: "sshServers"; servers: SshServerMeta[] }
  /** An SSH probe finished. */
  | { type: "sshTestResult"; id: string; result: SshTestResult }
  /** The agent asked the user to add a server (interactive sshAdd step). */
  | { type: "sshAddRequest"; messageId: string; stepId: string; reason?: string }
  /** The agent asked the user to pick server(s) (interactive sshPick step). */
  | {
      type: "sshPickRequest";
      messageId: string;
      stepId: string;
      prompt?: string;
      multi: boolean;
      servers: SshServerMeta[];
    }
  /** Play a notification sound in the webview (host has no audio device). */
  | { type: "notify"; event: "complete" | "approval" | "error" }
  /** Remote bridge status changed (settings tab + pairing UI). */
  | { type: "remote"; status: RemoteStatus };

export interface WebviewState {
  authed: boolean;
  plan?: PlanId;
  models: ModelInfo[];
  /** Connected providers (Luno + custom), for grouping and the Connect panel. */
  providers?: Provider[];
  selectedModel?: string;
  usage?: UsageSnapshot;
  messages: ChatMessage[];
  /** Backend non-logging guarantee, drives the "Prompts not logged" badge. */
  nonLogging: boolean;
  conn: ConnState;
  settings: LunoSettings;
  account?: string;
  /** Full signed-in profile (name/email/avatar/plan) from the cabinet. */
  profile?: AccountProfile;
  /** Id of the session currently loaded in the chat, if any. */
  activeSessionId?: string;
  /** Composer draft for the ACTIVE chat (text + attachments + context) —
   *  restored on chat switch and across VS Code restarts. */
  draft?: ComposerDraft;
  /** SSH servers (metadata only), for the SSH settings tab. */
  sshServers?: SshServerMeta[];
}

/** A composer draft persisted per chat (host globalState). */
export interface ComposerDraft {
  text: string;
  attachments?: ChatAttachment[];
  contextPaths?: string[];
}
