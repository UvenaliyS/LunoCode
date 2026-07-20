/**
 * Local copy of the shared contracts.
 *
 * The extension is bundled with esbuild and ships standalone, so rather than
 * depend on a path-linked workspace package at runtime we re-export the shared
 * types here. Keep this in sync with packages/shared/src/index.ts — it is the
 * same contract, intentionally duplicated to keep the bundle self-contained.
 */
export type {
  PlanId,
  PlanLimits,
  UsageSnapshot,
  UsageBucket,
  ModelInfo,
  ModelBrand,
  Provider,
  ProviderKind,
  ProviderFormat,
  ProviderTestResult,
  DeviceCodeStart,
  DeviceCodePollStatus,
  AccountProfile,
  ChatRole,
  ChatAttachment,
  ChatMessage,
  ChatMode,
  ToolName,
  ToolCall,
  AgentStep,
  StepStatus,
  ApprovalMode,
  ChatSession,
  ChatSessionMeta,
  ComposerDraft,
  LinkChannel,
  WebviewToExtension,
  ExtensionToWebview,
  WebviewState,
  ViewKind,
  SettingsTabId,
  ConnState,
  LunoSettings,
  NotificationSettings,
  AutoApproveSettings,
  ContextSettings,
  DisplaySettings,
  SshAuthMethod,
  SshServerMeta,
  SshServerInput,
  SshTestResult,
  RemoteScope,
  RemoteDevice,
  RemoteStatus,
  RemoteSettings,
} from "@luno/shared";

export {
  SONNET_EQ,
  MUTATING_TOOLS,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_AUTO_APPROVE,
  DEFAULT_CONTEXT,
  DEFAULT_DISPLAY,
  DEFAULT_REMOTE,
  LUNO_HOST_RE,
  isLunoEndpoint,
  inferModelBrand,
} from "@luno/shared";

export type { RelayFrame, RelayTgUser } from "@luno/shared/src/relay";
export {
  parseRelayFrame,
  RELAY_CLOSE_REVOKED,
  RELAY_CLOSE_BAD_KEY,
  PAIR_QR_PREFIX,
} from "@luno/shared/src/relay";
