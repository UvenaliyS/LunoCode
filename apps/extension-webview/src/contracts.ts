/**
 * Mirror of packages/shared/src/index.ts message contracts, scoped to what the
 * webview needs. Kept local so the webview bundle has no path-link runtime dep.
 */
export type PlanId = "STARTER" | "PLUS" | "POWER" | "DEV";

export interface PlanLimits {
  fiveHourLimit: number;
  weeklyLimit: number;
  totalLimit: number;
  concurrency: number;
  priority: number;
}

export interface UsageBucket {
  id: "fiveHour" | "weekly" | "total";
  label: string;
  used: number;
  limit: number;
  resetAt?: number;
}

export interface UsageSnapshot {
  plan: PlanId;
  limits: PlanLimits;
  buckets: UsageBucket[];
  /** Overview extras (site dashboard parity) — absent on older gateways. */
  bonusBalance?: number;
  rpmLimit?: number;
  requestsToday?: number;
  requestsMonth?: number;
}

/** The signed-in account, as the personal cabinet reports it (GET /account/me).
 *  `avatar` is the site's generated-avatar token ("luno:<palette>:<icon>"). */
export interface AccountProfile {
  name?: string;
  email?: string;
  avatar?: string | null;
  plan?: string;
  /** Unix ms when the current plan expires, if the plan is time-boxed. */
  planExpiresAt?: number;
}

/** Model brand, inferred from the model id/label. Drives icons + grouping. */
export type ModelBrand = "anthropic" | "openai" | "google" | "xai" | "other";

export interface ModelInfo {
  id: string;
  label: string;
  sonnetEq: number;
  providerId?: string;
  /** Brand inferred from the id (claude/gpt/gemini/grok), for icons. */
  brand?: ModelBrand;
  /** Effective wire format this model is called with (after auto/override). */
  format?: ProviderFormat;
  hidden?: boolean;
}

/** Infer the brand from a model id/label. Mirror of the shared helper. */
export function inferModelBrand(idOrLabel: string): ModelBrand {
  const s = idOrLabel.toLowerCase();
  if (/(claude|opus|sonnet|haiku|fable|anthropic)/.test(s)) return "anthropic";
  if (/(gpt|openai|o1|o3|o4|codex|davinci)/.test(s)) return "openai";
  if (/(gemini|google|palm|bard)/.test(s)) return "google";
  if (/(grok|xai)/.test(s)) return "xai";
  return "other";
}

/**
 * Wire format a provider speaks — decides request shape, tool environment and
 * streaming protocol. claude-code = Anthropic Messages + CC tools; codex =
 * OpenAI Responses + Codex tools; openai-v1 = universal Chat Completions.
 */
export type ProviderFormat = "claude-code" | "codex" | "openai-v1";

export type ProviderKind = "luno" | "custom";

/** Result of the connection test run when a provider is added/edited. */
export interface ProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  modelCount?: number;
  error?: string;
  testedAt: number;
}

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  endpoint: string;
  format?: ProviderFormat;
  autoFormat?: boolean;
  modelFormats?: Record<string, ProviderFormat>;
  hasKey?: boolean;
  builtin?: boolean;
  lastTest?: ProviderTestResult;
}

export type ChatRole = "user" | "assistant" | "system";

export type ChatMode = "chat" | "agent";

/**
 * A binary attachment that travels with a prompt as a real content block.
 * Images and PDFs are the two kinds Claude accepts directly; other files are
 * referenced by path instead (the host inlines their text).
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

/**
 * Tool vocabulary the webview can render. Two dialects coexist:
 *  - canonical Claude CLI names (Bash, Read, Write, …) — used by the dev
 *    preview and by claude-code-format providers;
 *  - the local runner names (readFile, runCommand, …) — used by the built-in
 *    agent runner and the mock gateway;
 * plus the SSH subsystem tools. Renderers must fall back gracefully on
 * anything they don't recognize.
 */
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
  // local runner dialect:
  | "readFile"
  | "listDir"
  | "writeFile"
  | "applyEdit"
  | "runCommand"
  // SSH subsystem (credentials are never visible to the model):
  | "sshList"
  | "sshExec"
  | "sshAdd"
  | "sshPick";

export type StepStatus = "running" | "done" | "error" | "rejected";

export type TodoStatus = "pending" | "active" | "done";
export interface TodoItem {
  text: string;
  status: TodoStatus;
}

/** How a server authenticates. The secret itself lives in OS Secret Storage. */
export type SshAuthMethod = "password" | "privateKey";

/** What the model/webview sees about an SSH server — never credentials. */
export interface SshServerMeta {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: SshAuthMethod;
  createdAt: number;
}

/** Payload for adding/updating a server (secret travels host-side only). */
export interface SshServerInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  auth: SshAuthMethod;
  secret?: string;
  passphrase?: string;
}

/** Result of an SSH connectivity probe (on add / test button). */
export interface SshTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  testedAt: number;
}

export interface ToolCall {
  name: ToolName;
  title: string;
  input: Record<string, unknown>;
  output?: string;
  diff?: string;
  path?: string;
  /** TodoWrite — the plan checklist. */
  todos?: TodoItem[];
  /** ExitPlanMode — the proposed plan (markdown). */
  plan?: string;
  /** AskUserQuestion — a question with selectable options. Options can carry a
   *  recommendation flag and a preview (rendered in a monospace box). */
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

export interface AskOption {
  label: string;
  description?: string;
  recommended?: boolean;
  /** Optional preview content shown when the option is selected (monospace). */
  preview?: string;
}

export interface AgentStep {
  id: string;
  kind: "thinking" | "tool";
  status: StepStatus;
  title: string;
  /** thinking — the reasoning text shown when the block is expanded. */
  detail?: string;
  tool?: ToolCall;
  error?: string;
}

export type ApprovalMode = "ask" | "auto";

/**
 * One block in an assistant turn's chronological feed — text or a reference to
 * a tool step. Preserves the exact interleave order so the UI is a single
 * timeline (text → the tool it triggered → next text…).
 */
export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "step"; stepId: string };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean;
  model?: string;
  sonnetEqCost?: number;
  /** Wall-clock time the assistant turn took, ms. */
  elapsedMs?: number;
  /** True when the user stopped this turn mid-stream (renders a divider). */
  stopped?: boolean;
  /** Accumulated reasoning text streamed before/among the answer (agent mode). */
  thinking?: string;
  steps?: AgentStep[];
  /** Chronological feed of text + tool-step references, in emission order. */
  blocks?: MessageBlock[];
  /** Binary attachments (images/PDFs) sent with a user message, for preview. */
  attachments?: ChatAttachment[];
  /** Context file paths referenced by a user message, for preview. */
  contextPaths?: string[];
}

/** Lightweight session descriptor for the history list (no message bodies). */
export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model?: string;
  messageCount: number;
  preview: string;
}

/** Which screen a given webview renders. Injected via window.__LUNO_VIEW__. */
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

/** Connection state to the gateway — drives offline-graceful UI. */
export type ConnState = "unknown" | "online" | "offline";

/** How the user is linking their account. */
export type LinkChannel = "telegram" | "web";

export interface NotificationSettings {
  enabled: boolean;
  onComplete: boolean;
  onApproval: boolean;
  onError: boolean;
  sound: boolean;
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

export const DEFAULT_AUTO_APPROVE: AutoApproveSettings = {
  readFiles: true,
  writeFiles: false,
  applyEdits: false,
  runCommands: false,
  sshCommands: false,
  // Read-only shell commands, safe to run without a prompt (mirror of shared).
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

export const DEFAULT_CONTEXT: ContextSettings = {
  autoCompact: true,
  compactThresholdPct: 80,
  pruneOldOutputs: true,
  maxFileSizeKb: 20,
  customInstructions: "",
};

export const DEFAULT_DISPLAY: DisplaySettings = {
  uiScale: 1,
  fontScale: 1,
  collapseThinking: false,
  collapseToolOutput: false,
};

export interface LunoSettings {
  gatewayUrl: string;
  defaultModel: string;
  streamResponses: boolean;
  showSonnetEqCost: boolean;
  approvalMode: ApprovalMode;
  /** Inject the SSH subsystem prompt + tools into agent runs (default on). */
  sshEnabled: boolean;
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
  hiddenModels: string[];
  customModels: CustomModel[];
}

export interface CustomModel {
  id: string;
  label: string;
  providerId?: string;
}

// --- Remote control (Telegram WebApp) — mirrors @luno/shared -----------------

/** What a paired device may touch: one workspace or the whole extension. */
export type RemoteScope = "project" | "system";

/** A phone (Telegram WebApp) paired to this extension instance. */
export interface RemoteDevice {
  id: string;
  label: string;
  tgId: number;
  scope: RemoteScope;
  workspaceHash?: string;
  workspaceName?: string;
  createdAt: number;
  lastSeenAt?: number;
}

/** Remote bridge status, rendered in the Remote settings tab. */
export interface RemoteStatus {
  enabled: boolean;
  serverUrl: string;
  connected: boolean;
  devices: RemoteDevice[];
  pairing?: { code: string; expiresAt: number };
}

/** Remote settings persisted in luno.json. */
export interface RemoteSettings {
  enabled: boolean;
  serverUrl: string;
}

export const DEFAULT_REMOTE: RemoteSettings = {
  enabled: false,
  // Dedicated WS hostname (Cloudflare) — webapp.luno.codes is Fastly (no WS).
  serverUrl: "wss://webapp-events.luno.codes",
};

/** Fine-grained auto-approval — which tool classes skip the approval gate while
 *  in "ask" mode (mirrors @luno/shared). */
export interface AutoApproveSettings {
  readFiles: boolean;
  writeFiles: boolean;
  applyEdits: boolean;
  runCommands: boolean;
  sshCommands: boolean;
  allowedCommands: string[];
  maxAutoApprovals: number;
}

/** Context-window management (mirrors @luno/shared). */
export interface ContextSettings {
  autoCompact: boolean;
  compactThresholdPct: number;
  pruneOldOutputs: boolean;
  maxFileSizeKb: number;
  customInstructions: string;
}

/** Chat/webview rendering preferences (mirrors @luno/shared). */
export interface DisplaySettings {
  uiScale: number;
  fontScale: number;
  collapseThinking: boolean;
  collapseToolOutput: boolean;
}

export interface WebviewState {
  authed: boolean;
  plan?: PlanId;
  models: ModelInfo[];
  providers?: Provider[];
  selectedModel?: string;
  usage?: UsageSnapshot;
  messages: ChatMessage[];
  nonLogging: boolean;
  conn: ConnState;
  settings: LunoSettings;
  /** Version reported by the installed extension manifest. */
  extensionVersion?: string;
  /** Telegram username when linked. */
  account?: string;
  /** Full signed-in profile (name/email/avatar/plan) from the cabinet. */
  profile?: AccountProfile;
  /** Id of the session currently loaded in the chat, if any. */
  activeSessionId?: string;
  /** Composer draft for the ACTIVE chat — restored on switch and restart. */
  draft?: ComposerDraft;
  /** List of chat sessions (for tabs). */
  sessions?: ChatSessionMeta[];
  /** SSH servers (metadata only), for the SSH settings tab. */
  sshServers?: SshServerMeta[];
}

/** A composer draft persisted per chat (host globalState). */
export interface ComposerDraft {
  text: string;
  attachments?: ChatAttachment[];
  contextPaths?: string[];
}

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
  | { type: "openConfigFile" }
  | { type: "exportConfig" }
  | { type: "importConfig" }
  | { type: "listSessions" }
  | { type: "loadSession"; id: string }
  | { type: "deleteSession"; id: string }
  | { type: "renameSession"; id: string; title: string }
  | { type: "listProviders" }
  | {
      type: "addProvider";
      label: string;
      endpoint: string;
      format: ProviderFormat;
      autoFormat: boolean;
      key?: string;
    }
  | {
      type: "updateProvider";
      id: string;
      label: string;
      endpoint: string;
      format: ProviderFormat;
      autoFormat: boolean;
      key?: string;
    }
  | { type: "deleteProvider"; id: string }
  | { type: "testProvider"; id: string }
  | { type: "setModelFormat"; providerId: string; modelId: string; format?: ProviderFormat }
  | {
      type: "approveToolCall";
      stepId: string;
      approved: boolean;
      /** When set, persist this command pattern to the auto-approve allow-list
       *  before resolving — the "Always allow …" action. */
      allowPattern?: string;
    }
  | { type: "addContext" }
  | { type: "sshList" }
  | { type: "sshUpsert"; server: SshServerInput }
  | { type: "sshDelete"; id: string }
  | { type: "sshTest"; id: string }
  | { type: "sshAddResolve"; stepId: string; added: boolean; serverId?: string }
  | { type: "sshPickResolve"; stepId: string; serverIds: string[] }
  // --- Remote control (Telegram WebApp) ---
  | { type: "remoteStatus" }
  | { type: "remoteSetEnabled"; enabled: boolean }
  | { type: "remoteNewPairCode" }
  | { type: "remoteRevoke"; deviceId: string };

export type ExtensionToWebview =
  | { type: "state"; state: WebviewState }
  | { type: "messageAppend"; message: ChatMessage }
  | { type: "messageChunk"; id: string; delta: string }
  | { type: "messageThinking"; id: string; delta: string }
  | { type: "messageDone"; id: string; sonnetEqCost?: number; elapsedMs?: number; stopped?: boolean }
  | { type: "usage"; usage: UsageSnapshot }
  | { type: "conn"; conn: ConnState }
  | { type: "error"; message: string }
  | { type: "navigate"; view: ViewKind; settingsTab?: SettingsTabId }
  /** Pop the composer's branded usage panel (status-bar click). */
  | { type: "showUsagePopover" }
  | {
      type: "linkChallenge";
      channel: LinkChannel;
      userCode: string;
      verificationUri: string;
      webVerificationUri: string;
    }
  | { type: "linkResult"; ok: boolean; error?: string }
  | { type: "sessions"; sessions: ChatSessionMeta[]; activeId?: string }
  | { type: "providers"; providers: Provider[] }
  | { type: "providerTest"; providerId: string; result: ProviderTestResult }
  | { type: "configTransfer"; op: "export" | "import"; ok: boolean; detail?: string }
  | { type: "agentStep"; messageId: string; step: AgentStep }
  | {
      type: "agentStepUpdate";
      messageId: string;
      stepId: string;
      patch: Partial<AgentStep>;
    }
  | { type: "agentStepOutput"; messageId: string; stepId: string; delta: string }
  | { type: "toolApprovalRequest"; messageId: string; stepId: string }
  | { type: "contextAdded"; paths: string[] }
  | { type: "attachmentsAdded"; attachments: ChatAttachment[] }
  /** The send failed before anything streamed — restore the full input. */
  | {
      type: "restoreInput";
      text: string;
      attachments?: ChatAttachment[];
      contextPaths?: string[];
    }
  | { type: "sshServers"; servers: SshServerMeta[] }
  | { type: "sshTestResult"; id: string; result: SshTestResult }
  | { type: "sshAddRequest"; messageId: string; stepId: string; reason?: string }
  | {
      type: "sshPickRequest";
      messageId: string;
      stepId: string;
      prompt?: string;
      multi: boolean;
      servers: SshServerMeta[];
    }
  | { type: "notify"; event: "complete" | "approval" | "error" }
  | { type: "remote"; status: RemoteStatus };
