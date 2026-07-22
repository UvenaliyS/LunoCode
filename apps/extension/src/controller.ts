import * as vscode from "vscode";
import * as crypto from "node:crypto";
import type { GatewayClient, ProviderTarget } from "./gatewayClient";
import type { AuthManager } from "./authManager";
import type { UsageStatusBar } from "./usageStatusBar";
import type { SessionStore } from "./sessionStore";
import type { ProviderStore } from "./providerStore";
import type { ConfigStore } from "./configStore";
import type { SshStore } from "./sshStore";
import type { NotificationService } from "./notifications";
import { AgentRunner, type SshBridge } from "./agentRunner";
import { buildSshSystemPrompt } from "./sshPrompt";
import { agentSystemPrompt } from "./agentPrompts";
import { compactMessages, pruneOldOutputs } from "./contextManager";
import { readSettings, writeSetting, type LunoSettings } from "./settings";
import type {
  ChatAttachment,
  ChatMessage,
  ChatMode,
  ConnState,
  ExtensionToWebview,
  ModelInfo,
  PromptOrigin,
  Provider,
  RemoteStatus,
  SettingsTabId,
  ToolName,
  WebviewToExtension,
  UsageSnapshot,
} from "./types";
import { inferModelBrand, LOCAL_ORIGIN } from "./types";

/** Minimal surface the controller needs from the remote bridge. Defined here
 *  (not imported) to avoid a controller ⇄ remoteBridge require cycle. */
export interface RemoteBridgeLike {
  status(): RemoteStatus;
  setEnabled(enabled: boolean): Promise<void>;
  requestPairCode(): void;
  revoke(deviceId: string): Promise<void>;
}

/**
 * Single source of truth for chat state, shared by every Luno webview (the
 * sidebar and any "Open in Tab" panels). Webviews register a poster; the
 * controller fans messages out to all of them so they stay in sync.
 */
export class LunoController {
  private posters = new Set<(msg: ExtensionToWebview) => void>();

  private messages: ChatMessage[] = [];
  private models: ModelInfo[] = [];
  private providers: Provider[] = [];
  private selectedModel: string;
  private nonLogging = true;
  private conn: ConnState = "unknown";
  /** Backoff retry loop that un-sticks the "Gateway offline" state. */
  private connRetryTimer?: NodeJS.Timeout;
  private connRetryMs = 5_000;
  private abort?: AbortController;
  /** Origin of the turn currently running — hardens the agent for
   *  project-scoped remote devices (one turn at a time; see handlePrompt). */
  private turnOrigin: PromptOrigin = LOCAL_ORIGIN;
  /** Last usage snapshot from the gateway, kept so a freshly-opened webview
   *  (e.g. the Settings tab panel) gets it in its initial state. */
  private lastUsage?: UsageSnapshot;
  /** Id of the session currently loaded; undefined until the first save. */
  private activeSessionId?: string;
  /** Pending tool-approval resolvers, keyed by step id (agent mode). */
  private approvals = new Map<string, (approved: boolean) => void>();
  /** Pending interactive sshAdd resolvers, keyed by step id. */
  private sshAdds = new Map<
    string,
    (res: { added: boolean; serverId?: string }) => void
  >();
  /** Pending interactive sshPick resolvers, keyed by step id. */
  private sshPicks = new Map<string, (ids: string[]) => void>();
  /** Sessions whose title has already been auto-generated (once per chat). */
  private titledSessions = new Set<string>();
  /** A title call is racing the current answer — one in flight at a time. */
  private pendingTitle = false;
  /** Remote (Telegram WebApp) bridge — injected after construction to avoid a
   *  constructor cycle; absent until the extension wires it. */
  private remoteBridge?: RemoteBridgeLike;

  constructor(
    private readonly gateway: GatewayClient,
    private readonly auth: AuthManager,
    private readonly usageBar: UsageStatusBar,
    private readonly sessions: SessionStore,
    private readonly providerStore: ProviderStore,
    private readonly config: ConfigStore,
    private readonly ssh: SshStore,
    private readonly notifier: NotificationService,
  ) {
    this.selectedModel = readSettings().defaultModel;
    this.auth.onDidChange(() => void this.onAuthChange());
    this.providerStore.onDidChange(() => void this.refreshModels());
    // SSH list changes (settings tab edits, config imports) refresh state so
    // open pickers and the SSH tab stay current.
    this.ssh.onDidChange(() => {
      this.broadcast({ type: "sshServers", servers: this.ssh.list() });
      this.pushState();
    });
    // Keep the status-bar meter live: usage otherwise only refreshed after a
    // turn, so an idle window showed stale numbers. Cheap key-authed GET.
    setInterval(
      () => {
        if (this.auth.isAuthed) void this.refreshUsage();
      },
      2 * 60 * 1000,
    ).unref?.();
  }

  // --- webview registration --------------------------------------------------

  attach(post: (msg: ExtensionToWebview) => void): () => void {
    this.posters.add(post);
    // Push current state immediately so a freshly-opened view is populated.
    post({ type: "state", state: this.snapshot() });
    return () => this.posters.delete(post);
  }

  /** Post the current state + session list to a single poster. Used by the
   *  remote bridge to resync one phone without re-broadcasting to everyone. */
  resyncPoster(post: (msg: ExtensionToWebview) => void): void {
    post({ type: "state", state: this.snapshot() });
    post({
      type: "sessions",
      sessions: this.sessions.list(),
      activeId: this.activeSessionId,
    });
  }

  /** Inject the remote bridge (called once from extension.ts activation). */
  setRemoteBridge(bridge: RemoteBridgeLike): void {
    this.remoteBridge = bridge;
  }

  private broadcast(msg: ExtensionToWebview): void {
    for (const p of this.posters) p(msg);
  }

  /** Public relay for services created before the controller (the notifier
   *  posts its sound events through here). */
  broadcastFromService(msg: ExtensionToWebview): void {
    this.broadcast(msg);
  }

  private pushState(): void {
    this.broadcast({ type: "state", state: this.snapshot() });
  }

  private snapshot() {
    const settings: LunoSettings = readSettings();
    return {
      authed: this.auth.isAuthed,
      plan: this.auth.currentPlan,
      models: this.models,
      providers: this.providers,
      selectedModel: this.selectedModel,
      messages: this.messages,
      usage: this.lastUsage,
      nonLogging: this.nonLogging,
      conn: this.conn,
      settings,
      account: this.auth.account,
      profile: this.auth.profile,
      activeSessionId: this.activeSessionId,
      draft: this.sessions.getDraft(this.activeSessionId),
      sessions: this.sessions.list(),
      sshServers: this.ssh.list(),
    };
  }

  // --- message handling ------------------------------------------------------

  async handle(
    msg: WebviewToExtension,
    origin: PromptOrigin = LOCAL_ORIGIN,
  ): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.pushState();
        await this.refreshModels();
        if (this.auth.isAuthed) await this.refreshUsage();
        break;
      case "sendPrompt":
        await this.handlePrompt(
          msg.text,
          msg.model ?? this.selectedModel,
          msg.mode ?? "chat",
          msg.contextPaths ?? [],
          msg.attachments ?? [],
          origin,
        );
        break;
      case "stop":
        // A stop must settle EVERYTHING in flight: the stream (via the abort
        // signal), the tool being executed, and any interactive card the
        // runner is blocked on — otherwise the turn hangs forever on an
        // unresolved promise.
        this.abort?.abort();
        this.cancelPendingInteractions();
        break;
      case "newChat":
        this.startNewChat();
        break;
      case "saveDraft":
        // Fire-and-forget persistence; the webview owns the live input state.
        void this.sessions.saveDraft(msg.sessionId, {
          text: msg.text,
          attachments: msg.attachments,
          contextPaths: msg.contextPaths,
        });
        break;
      case "selectModel":
        this.selectedModel = msg.model;
        break;
      case "login":
        await this.handleLogin(msg.channel ?? "telegram");
        break;
      case "submitKey":
        await this.handleSubmitKey(msg.key);
        break;
      case "startOAuth":
        // The production site has no browser-OAuth page (yet) — sign-in is by
        // API key from the dashboard. Opens an input box; the key is validated
        // against GET /v1/me and stored in Secret Storage.
        await this.handleKeySignIn();
        break;
      case "cancelLink":
        this.auth.cancelLink();
        break;
      case "logout":
        await vscode.commands.executeCommand("luno.logout");
        break;
      case "buyReset":
        await vscode.commands.executeCommand("luno.buyReset");
        break;
      case "openBilling":
        await vscode.env.openExternal(
          vscode.Uri.parse("https://luno.codes/dashboard"),
        );
        break;
      case "openSettings":
        this.openSettings(msg.tab);
        break;
      case "updateSetting":
        await writeSetting(
          msg.key,
          msg.value as LunoSettings[typeof msg.key],
        );
        if (msg.key === "gatewayUrl") {
          this.gateway.setBaseUrl(String(msg.value));
          await this.refreshModels();
        }
        this.pushState();
        break;
      case "testConnection":
        await this.refreshModels();
        break;
      case "reload":
        await this.refreshModels();
        break;
      case "openConfigFile":
        await this.config.openInEditor();
        break;
      case "exportConfig": {
        const r = await this.config.exportToFile();
        this.broadcast({
          type: "configTransfer",
          op: "export",
          ok: r.ok,
          detail: r.detail,
        });
        break;
      }
      case "importConfig": {
        const r = await this.config.importFromFile();
        this.broadcast({
          type: "configTransfer",
          op: "import",
          ok: r.ok,
          detail: r.detail,
        });
        if (r.ok) {
          await this.refreshModels();
          this.pushState();
        }
        break;
      }
      case "listSessions":
        this.broadcast({
          type: "sessions",
          sessions: this.sessions.list(),
          activeId: this.activeSessionId,
        });
        break;
      case "loadSession":
        this.loadSession(msg.id);
        break;
      case "deleteSession":
        await this.sessions.delete(msg.id);
        if (this.activeSessionId === msg.id) this.startNewChat();
        this.broadcast({
          type: "sessions",
          sessions: this.sessions.list(),
          activeId: this.activeSessionId,
        });
        break;
      case "renameSession":
        await this.sessions.rename(msg.id, msg.title);
        this.broadcast({
          type: "sessions",
          sessions: this.sessions.list(),
          activeId: this.activeSessionId,
        });
        break;
      case "listProviders":
        this.providers = await this.providerStore.list();
        this.broadcast({ type: "providers", providers: this.providers });
        break;
      case "addProvider": {
        const id = await this.providerStore.upsert(
          {
            label: msg.label,
            endpoint: msg.endpoint,
            format: msg.format,
            autoFormat: msg.autoFormat,
          },
          msg.key,
        );
        await this.testAndBroadcast(id);
        await this.refreshModels();
        break;
      }
      case "updateProvider": {
        await this.providerStore.upsert(
          {
            id: msg.id,
            label: msg.label,
            endpoint: msg.endpoint,
            format: msg.format,
            autoFormat: msg.autoFormat,
          },
          msg.key,
        );
        await this.testAndBroadcast(msg.id);
        await this.refreshModels();
        break;
      }
      case "deleteProvider":
        await this.providerStore.remove(msg.id);
        await this.refreshModels();
        this.broadcast({ type: "providers", providers: this.providers });
        break;
      case "testProvider":
        await this.testAndBroadcast(msg.id);
        break;
      case "setModelFormat":
        await this.providerStore.setModelFormat(
          msg.providerId,
          msg.modelId,
          msg.format,
        );
        await this.refreshModels();
        break;
      case "approveToolCall": {
        // "Always allow <pattern>": persist the command pattern to the
        // auto-approve allow-list so this shape never prompts again.
        if (msg.approved && msg.allowPattern) {
          const pat = msg.allowPattern.trim();
          const cur = readSettings().autoApprove;
          if (pat && !cur.allowedCommands.includes(pat)) {
            await writeSetting("autoApprove", {
              ...cur,
              allowedCommands: [...cur.allowedCommands, pat],
            });
          }
        }
        const resolve = this.approvals.get(msg.stepId);
        if (resolve) {
          this.approvals.delete(msg.stepId);
          resolve(msg.approved);
        }
        break;
      }
      case "addContext": {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        const picks = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: "Attach",
          defaultUri: root,
          // One category, no dropdown to fiddle with: every file is selectable
          // in a single pass. Images/PDFs get inlined as native blocks below;
          // any other file becomes a text attachment card (webchat parity).
          filters: { "All files": ["*"] },
        });
        if (!picks?.length) break;
        // ONE ordered attachment list (left-to-right = pick order): images and
        // PDFs as native base64 blocks, everything else as extracted text with
        // path/lines/bytes — the wire layer renders that as a second-layer
        // "user attached this file" note, like the SSH catalogue.
        const attachments: ChatAttachment[] = [];
        for (const uri of picks) {
          const att =
            (await tryReadAttachment(uri)) ??
            (await tryReadFileAttachment(uri, root));
          if (att) attachments.push(att);
        }
        if (attachments.length) {
          this.broadcast({ type: "attachmentsAdded", attachments });
        }
        break;
      }
      // --- SSH subsystem -----------------------------------------------------
      case "sshList":
        this.broadcast({ type: "sshServers", servers: this.ssh.list() });
        break;
      case "sshUpsert":
        try {
          await this.ssh.upsert(msg.server);
        } catch (err) {
          this.broadcast({ type: "error", message: errText(err) });
        }
        break;
      case "sshDelete":
        await this.ssh.remove(msg.id);
        break;
      case "sshTest": {
        const result = await this.ssh.test(msg.id);
        this.broadcast({ type: "sshTestResult", id: msg.id, result });
        break;
      }
      case "sshAddResolve": {
        const resolve = this.sshAdds.get(msg.stepId);
        if (resolve) {
          this.sshAdds.delete(msg.stepId);
          resolve({ added: msg.added, serverId: msg.serverId });
        }
        break;
      }
      case "sshPickResolve": {
        const resolve = this.sshPicks.get(msg.stepId);
        if (resolve) {
          this.sshPicks.delete(msg.stepId);
          resolve(msg.serverIds);
        }
        break;
      }
      // --- Remote control (Telegram WebApp) — delegated to the bridge -------
      case "remoteStatus":
        if (this.remoteBridge)
          this.broadcast({ type: "remote", status: this.remoteBridge.status() });
        break;
      case "remoteSetEnabled":
        if (this.remoteBridge) await this.remoteBridge.setEnabled(msg.enabled);
        break;
      case "remoteNewPairCode":
        this.remoteBridge?.requestPairCode();
        break;
      case "remoteRevoke":
        if (this.remoteBridge) await this.remoteBridge.revoke(msg.deviceId);
        break;
    }
  }

  newChat(): void {
    this.startNewChat();
  }

  /** Opens the Settings editor tab; injected by extension.ts (PanelManager)
   *  to avoid a circular import. */
  private settingsOpener?: (tab?: SettingsTabId) => void;

  setSettingsOpener(open: (tab?: SettingsTabId) => void): void {
    this.settingsOpener = open;
  }

  /** Open the full settings UI in its own editor tab (Kilo-style — the
   *  sidebar chat is never hijacked). Falls back to in-place navigation only
   *  if the opener was never injected. */
  openSettings(tab?: SettingsTabId): void {
    if (this.settingsOpener) {
      this.settingsOpener(tab);
      return;
    }
    this.broadcast({ type: "navigate", view: "settings", settingsTab: tab });
  }

  /** Reject every pending approval / SSH interaction. Called on stop and at
   *  the end of every turn so no resolver can leak across turns. */
  private cancelPendingInteractions(): void {
    for (const resolve of this.approvals.values()) resolve(false);
    this.approvals.clear();
    for (const resolve of this.sshAdds.values()) resolve({ added: false });
    this.sshAdds.clear();
    for (const resolve of this.sshPicks.values()) resolve([]);
    this.sshPicks.clear();
  }

  /** Run a provider connection test and stream the outcome to the webviews. */
  private async testAndBroadcast(providerId: string): Promise<void> {
    try {
      const result = await this.providerStore.test(providerId);
      this.broadcast({ type: "providerTest", providerId, result });
    } catch (err) {
      this.broadcast({
        type: "providerTest",
        providerId,
        result: { ok: false, error: errText(err), testedAt: Date.now() },
      });
    }
    this.providers = await this.providerStore.list();
    this.broadcast({ type: "providers", providers: this.providers });
  }

  /** Reset to a fresh, unsaved chat. The previous session is already persisted
   * (autosaved per turn), so this only detaches — nothing is lost. */
  private startNewChat(): void {
    this.messages = [];
    this.activeSessionId = undefined;
    this.pushState();
  }

  /** Load a saved session into the active chat in-place (no new tab/jump). */
  private loadSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.messages = session.messages.map((m) => ({ ...m }));
    this.activeSessionId = session.id;
    if (session.model) this.selectedModel = session.model;
    this.pushState();
    this.broadcast({ type: "navigate", view: "chat" });
  }

  /** Drive a device-code link inline: surface code+QR in the webview, then
   * report the outcome. Reused by every link entry point. */
  private async handleLogin(channel: "telegram" | "web"): Promise<void> {
    try {
      const ok = await this.auth.login(channel, (c) => {
        this.broadcast({
          type: "linkChallenge",
          channel: c.channel,
          userCode: c.userCode,
          verificationUri: c.verificationUri,
          webVerificationUri: c.webVerificationUri,
        });
      });
      this.broadcast({ type: "linkResult", ok });
    } catch {
      // The production gateway has no device-code endpoints (yet) — fall back
      // to the API-key sign-in so the button still leads somewhere useful.
      await this.handleKeySignIn();
    }
  }

  /**
   * Sign in with an API key from the dashboard (luno.codes → Dashboard → API
   * Keys). Native input box; the key never touches the webview and lands in
   * Secret Storage via AuthManager.
   */
  private async handleKeySignIn(): Promise<void> {
    void vscode.window
      .showInformationMessage(
        "Luno: create an API key at luno.codes → Dashboard → API Keys, then paste it here.",
        "Open dashboard",
      )
      .then((choice) => {
        if (choice === "Open dashboard") {
          void vscode.env.openExternal(
            vscode.Uri.parse("https://luno.codes/dashboard"),
          );
        }
      });
    const key = await vscode.window.showInputBox({
      title: "Luno — Sign in with API key",
      prompt: "Paste your Luno API key (from luno.codes → Dashboard → API Keys)",
      placeHolder: "sk-clau_…",
      password: true,
      ignoreFocusOut: true,
    });
    if (!key || !key.trim()) {
      this.broadcast({ type: "linkResult", ok: false });
      return;
    }
    await this.handleSubmitKey(key);
  }

  /** Validate and store a pasted API key, reporting the outcome inline. */
  private async handleSubmitKey(key: string): Promise<void> {
    try {
      const ok = await this.auth.loginWithKey(key);
      this.broadcast({
        type: "linkResult",
        ok,
        error: ok ? undefined : "Invalid API key.",
      });
    } catch (err) {
      this.broadcast({ type: "linkResult", ok: false, error: errText(err) });
    }
  }

  private async handlePrompt(
    text: string,
    model: string,
    mode: ChatMode,
    contextPaths: string[] = [],
    attachments: ChatAttachment[] = [],
    origin: PromptOrigin = LOCAL_ORIGIN,
  ): Promise<void> {
    void mode; // tools are always available now; the chat/agent toggle is cosmetic
    // Remember who started this turn — buildAgentRunner reads it to harden the
    // approval policy for project-scoped remote devices. One turn at a time
    // (a new prompt aborts the previous), so an instance field is safe.
    this.turnOrigin = origin;
    // Read any attached context files and build a preamble injected into the
    // model input only — the displayed user message stays as the typed text,
    // with the attached files listed for reference.
    const contextBlock = await this.readContext(contextPaths);

    // The displayed user message is the typed text; attachments and context
    // files ride as structured metadata so the webview can render real preview
    // cards (never as a "_Attached: …_" text note).
    const userMsg: ChatMessage = {
      id: rid(),
      role: "user",
      content: text,
      attachments: attachments.length ? attachments : undefined,
      contextPaths: contextPaths.length ? contextPaths : undefined,
    };
    this.messages.push(userMsg);
    this.broadcast({ type: "messageAppend", message: userMsg });

    const asstId = rid();
    const asstMsg: ChatMessage = {
      id: asstId,
      role: "assistant",
      content: "",
      streaming: true,
      model,
      steps: [], // Always enable steps/tools for native agent path
      blocks: [], // Chronological text/tool feed (order preserved for the UI)
    };
    this.messages.push(asstMsg);
    this.broadcast({ type: "messageAppend", message: asstMsg });

    // Chat title: fire the tiny title call IN PARALLEL with the answer (the
    // webchat/CLI pattern — two concurrent requests on the first real turn),
    // never after messageDone. Applied in `finally` once the session exists.
    const titlePromise = this.shouldGenerateTitle(text, model)
      ? this.gateway.generateTitle(text, model)
      : null;

    this.abort = new AbortController();
    try {
      const target = await this.targetForModel(model);
      const settings = readSettings();

      // System context: agent identity (custom providers only) + user rules +
      // attached files + SSH catalogue. The environment block (OS, shell, cwd)
      // deliberately does NOT ride here — for the built-in Luno Claude path the
      // gateway REPLACES our system with the captured Claude Code prompt, so
      // anything in `system` never reaches the model. Messages pass through
      // untouched, so the environment is injected into the current user turn
      // below instead.
      const systemBlocks: string[] = [];
      if (target.kind === "custom") {
        systemBlocks.push(agentSystemPrompt(target.format));
      }
      const rules = settings.context.customInstructions.trim();
      if (rules) systemBlocks.push(rules);
      if (contextBlock) systemBlocks.push(contextBlock);
      if (settings.sshEnabled) {
        systemBlocks.push(buildSshSystemPrompt(this.ssh.list()));
      }

      // Context-window management (cache-safe: both mutate history permanently
      // at the OLD end, so the cached prefix survives across turns).
      if (settings.context.pruneOldOutputs) pruneOldOutputs(this.messages);
      if (settings.context.autoCompact) {
        this.messages = compactMessages(this.messages, settings.context);
      }

      const wireMessages = this.messages
        .filter((m) => m.role !== "system" && m.id !== asstId)
        .map((m) => ({ role: m.role, content: m.content }));
      // Environment (OS/shell/cwd/git) rides in the message stream, not system:
      // the Luno gateway swaps out our system for the captured CC prompt, so
      // `messages` is the only channel that survives. Prepend exactly one fresh
      // block to a COPY of the latest user turn — never mutate this.messages, so
      // the UI/history stay clean and the block doesn't accumulate over turns.
      const envBlock = this.environmentBlock(await this.isGitRepo());
      for (let i = wireMessages.length - 1; i >= 0; i--) {
        const m = wireMessages[i];
        if (m.role === "user" && typeof m.content === "string") {
          wireMessages[i] = { ...m, content: `${envBlock}\n\n${m.content}` };
          break;
        }
      }
      const system = systemBlocks.length ? systemBlocks.join("\n\n") : undefined;
      const chatBody = {
        model,
        system,
        messages: wireMessages,
        attachments: attachments.length ? attachments : undefined,
      };
      const onChunk = (delta: string) => {
        asstMsg.content += delta;
        // Mirror the webview's block-feed logic host-side so session reloads and
        // remote resyncs carry the same chronological order: append to a
        // trailing text block, or open a new one after a tool step.
        if (!asstMsg.blocks) asstMsg.blocks = [];
        const last = asstMsg.blocks[asstMsg.blocks.length - 1];
        if (last && last.kind === "text") last.text += delta;
        else asstMsg.blocks.push({ kind: "text", text: delta });
        this.broadcast({ type: "messageChunk", id: asstId, delta });
      };

      let sonnetEqCost = 0;
      const streamStartMs = Date.now();
      // Agentic tool-use loop — one interleaved stream of text + tool calls
      // (executed with the approval gate), the same way the real Claude Code /
      // Codex clients behave: nothing stops mid-turn, tools always available,
      // the model decides when to call them. Routed by wire format so EVERY
      // provider (Luno + custom) gets the full tool set with identical names:
      //   Luno Claude models, custom claude-code → Anthropic Messages
      //   custom codex → OpenAI Responses
      //   Luno non-Claude, custom openai-v1 → OpenAI Chat Completions
      // Every path executes through the same AgentRunner.
      ({ sonnetEqCost } = await this.runNativeAgent(
        asstMsg,
        target,
        chatBody,
        onChunk,
      ));
      // A user stop aborts the signal and the loop returns normally — mark the
      // turn so the UI renders the "stopped by user" divider, not a clean end.
      const wasStopped = this.abort?.signal.aborted === true;
      asstMsg.streaming = false;
      asstMsg.stopped = wasStopped || undefined;
      asstMsg.sonnetEqCost = sonnetEqCost;
      const elapsedMs = Date.now() - streamStartMs;
      asstMsg.elapsedMs = elapsedMs; // persist so pushState/session reload keeps it
      this.broadcast({
        type: "messageDone",
        id: asstId,
        sonnetEqCost,
        elapsedMs,
        stopped: wasStopped || undefined,
      });
      this.setConn("online");
      if (!wasStopped) this.notifier.notify("complete", "Luno: task finished.");
      if (this.auth.isAuthed) await this.refreshUsage();
    } catch (err) {
      // An abort mid-fetch surfaces as a throw — that's a user stop, not an
      // error: settle the turn with the stopped marker and no error banner.
      const wasStopped = this.abort?.signal.aborted === true;
      asstMsg.streaming = false;
      asstMsg.stopped = wasStopped || undefined;
      this.broadcast({
        type: "messageDone",
        id: asstId,
        stopped: wasStopped || undefined,
      });
      if (!wasStopped) {
        const message = errText(err);
        // Nothing streamed and no tool ran → the turn never happened. Roll the
        // user+assistant messages back out of history and hand the FULL input
        // (text + attachments + context) back to the composer, so a retry
        // can't double-append the same turn into the context.
        const nothingLanded =
          asstMsg.content.length === 0 && (asstMsg.steps?.length ?? 0) === 0;
        if (nothingLanded) {
          this.messages = this.messages.filter(
            (m) => m.id !== userMsg.id && m.id !== asstId,
          );
          this.broadcast({
            type: "restoreInput",
            text,
            attachments: attachments.length ? attachments : undefined,
            contextPaths: contextPaths.length ? contextPaths : undefined,
          });
        }
        this.broadcast({ type: "error", message });
        this.notifier.notify("error", `Luno: ${message}`);
        this.setConn("offline");
      }
    } finally {
      this.abort = undefined;
      // No resolver may outlive its turn — a stray pending approval would
      // block the next agent run forever.
      this.cancelPendingInteractions();
      // Autosave the session after every turn (local history). First save
      // creates it; later turns update it in place — no jumping to a new chat.
      const hadSession = this.activeSessionId;
      this.activeSessionId = await this.sessions.save(
        this.activeSessionId,
        this.messages,
        this.selectedModel,
        this.workspaceStamp(),
      );
      // First save minted the session id → the fresh chat's draft slot (if
      // any) now belongs to it.
      if (!hadSession && this.activeSessionId) {
        await this.sessions.migrateNewChatDraft(this.activeSessionId);
      }
      this.pushState();
      // Apply the parallel title (fired alongside the answer above) now that
      // the session exists. Non-blocking: the turn is already settled.
      if (titlePromise) void this.applyGeneratedTitle(titlePromise);
    }
  }

  /**
   * A compact environment block wrapped in <environment>…</environment>: OS,
   * default shell, workspace / active-file paths, git status, and today's date.
   * Injected into the current user turn (see sendPrompt) so the model never runs
   * `pwd`, never guesses bash-vs-powershell, and can use absolute paths right
   * away. Wrapped in a tag (not a "# Environment" heading) to keep it distinct
   * from the gateway's Claude Code system section. `isGit` comes from the async
   * isGitRepo() helper; leave it undefined to omit the git line entirely.
   */
  private environmentBlock(isGit: boolean | undefined): string {
    const platform = process.platform; // win32 | darwin | linux
    const osName =
      platform === "win32"
        ? "Windows"
        : platform === "darwin"
          ? "macOS"
          : "Linux";
    const shell =
      platform === "win32"
        ? "PowerShell (powershell.exe) — NOT bash. Use PowerShell syntax (`;` to chain, `Get-ChildItem`/`ls`, no `&&`)."
        : "/bin/bash";
    const folder = vscode.workspace.workspaceFolders?.[0];
    const cwd = folder?.uri.fsPath ?? "(no folder open)";
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    const lines = [
      "<environment>",
      `OS: ${osName} (${platform})`,
      `Default shell for shell/Bash commands: ${shell}`,
      `Working directory: ${cwd}`,
    ];
    if (folder) lines.push(`Project folder: ${folder.name}`);
    if (active) lines.push(`Open file: ${active}`);
    if (isGit !== undefined) lines.push(`Is a git repository: ${isGit}`);
    lines.push(`Today's date: ${new Date().toISOString().slice(0, 10)}`);
    lines.push(
      "Use these facts directly — do not run pwd/cd to discover them, and match shell commands to the OS above.",
      "</environment>",
    );
    return lines.join("\n");
  }

  /**
   * Detect whether the workspace root is a git repo by stat-ing its `.git`
   * entry. Kept separate from environmentBlock so that stays synchronous.
   * Returns undefined when there's no folder or the check throws, so the caller
   * omits the line rather than guessing `false`.
   */
  private async isGitRepo(): Promise<boolean | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    try {
      await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(folder.uri, ".git"),
      );
      return true;
    } catch {
      return undefined;
    }
  }

  /**
   * Read attached context files and format them as a system preamble. Files
   * that can't be read (deleted, binary, too big) are skipped with a note.
   * Each file is capped so a large attachment can't blow up the request.
   */
  private async readContext(paths: string[]): Promise<string> {
    if (paths.length === 0) return "";
    const cap = Math.max(1, readSettings().context.maxFileSizeKb) * 1024;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const blocks: string[] = [];
    for (const rel of paths) {
      try {
        const uri = root ? vscode.Uri.joinPath(root, rel) : vscode.Uri.file(rel);
        const bytes = await vscode.workspace.fs.readFile(uri);
        let text = new TextDecoder().decode(bytes);
        if (text.length > cap) text = text.slice(0, cap) + "\n… (truncated)";
        blocks.push(`File: ${rel}\n\`\`\`\n${text}\n\`\`\``);
      } catch {
        blocks.push(`File: ${rel}\n(could not read)`);
      }
    }
    return `The user attached these files as context:\n\n${blocks.join("\n\n")}`;
  }

  /**
   * Native Claude agent turn: the model interleaves text and real tool_use
   * calls over /v1/messages. Each tool runs through the same AgentRunner
   * (approval gate, SSH, workspace fs) and the result feeds back as a
   * tool_result — looping until the model finishes. This is what makes the
   * client behave like the real Claude Code CLI: tools actually fire, nothing
   * stops mid-turn, approvals line up with the model's own tool_use ids.
   */
  private async runNativeAgent(
    asstMsg: ChatMessage,
    target: ProviderTarget,
    chatBody: {
      model: string;
      system?: string;
      messages: { role: string; content: string }[];
      attachments?: ChatAttachment[];
    },
    onChunk: (delta: string) => void,
  ): Promise<{ sonnetEqCost: number }> {
    if (!asstMsg.steps) asstMsg.steps = [];
    const runner = this.buildAgentRunner(asstMsg);
    runner.resetAutoApprovals();
    const exec = (
      name: ToolName,
      input: Record<string, unknown>,
      toolUseId: string,
    ) => runner.invokeTool(name, input, toolUseId, this.abort!.signal);
    const hooks = {
      onChunk,
      onThinking: (delta: string) =>
        this.broadcast({ type: "messageThinking", id: asstMsg.id, delta }),
    };

    // Pick the agentic loop by the target's wire format so every provider gets
    // the SAME tool set (identical names) executed through the SAME AgentRunner:
    //   claude-code → Anthropic Messages (/v1/messages)
    //   codex       → OpenAI Responses (/v1/responses)
    //   openai-v1   → OpenAI Chat Completions (/v1/chat/completions)
    // For the built-in Luno provider we route by the model's brand.
    const format =
      target.kind === "luno"
        ? inferModelBrand(chatBody.model) === "anthropic"
          ? "claude-code"
          : "openai-v1"
        : target.format;

    if (format === "codex") {
      return this.gateway.streamCodexAgentic(
        target,
        chatBody,
        exec,
        hooks,
        this.abort!.signal,
      );
    }
    if (format === "openai-v1") {
      return this.gateway.streamOpenAIAgentic(
        target,
        chatBody,
        exec,
        hooks,
        this.abort!.signal,
      );
    }
    return this.gateway.streamClaudeAgentic(
      target,
      chatBody,
      exec,
      hooks,
      this.abort!.signal,
    );
  }

  /**
   * Build an AgentRunner wired to this turn's assistant message: steps stream
   * to the webview, approvals/SSH interactions resolve through the pending-
   * interaction maps. Shared by the legacy plan path and the native loop.
   */
  private buildAgentRunner(asstMsg: ChatMessage): AgentRunner {
    // The mock gateway's SSH plan uses "$picked" as the serverId placeholder;
    // the runner substitutes it with the first server the user picked.
    let pickedIds: string[] = [];

    const settings = readSettings();
    const sshBridge: SshBridge = {
      enabled: settings.sshEnabled,
      list: () => this.ssh.list(),
      exec: async (serverId, command, onData, signal) => {
        const resolvedId =
          serverId === "$picked" && pickedIds[0] ? pickedIds[0] : serverId;
        const meta = this.ssh.get(resolvedId);
        if (!meta) throw new Error(`Unknown SSH server: ${resolvedId}`);
        const creds = await this.ssh.getSecret(resolvedId);
        if (!creds) {
          throw new Error(
            "No stored credentials for this server — re-add them in Settings → SSH.",
          );
        }
        const { sshExec: exec } = await import("./sshService");
        return exec(meta, creds, command, onData, signal);
      },
    };

    const runner = new AgentRunner(
      {
        onStep: (step) => {
          asstMsg.steps?.push(step);
          // Anchor the step in the chronological feed after any preceding text.
          if (!asstMsg.blocks) asstMsg.blocks = [];
          asstMsg.blocks.push({ kind: "step", stepId: step.id });
          this.broadcast({ type: "agentStep", messageId: asstMsg.id, step });
        },
        onStepUpdate: (stepId, patch) => {
          const step = asstMsg.steps?.find((s) => s.id === stepId);
          if (step) Object.assign(step, patch);
          this.broadcast({
            type: "agentStepUpdate",
            messageId: asstMsg.id,
            stepId,
            patch,
          });
        },
        onOutput: (stepId, delta) => {
          this.broadcast({
            type: "agentStepOutput",
            messageId: asstMsg.id,
            stepId,
            delta,
          });
        },
        requestApproval: (stepId) =>
          new Promise<boolean>((resolve) => {
            this.approvals.set(stepId, resolve);
            this.broadcast({
              type: "toolApprovalRequest",
              messageId: asstMsg.id,
              stepId,
            });
            this.notifier.notify(
              "approval",
              "Luno: the agent is waiting for your approval.",
            );
          }),
        requestSshAdd: (stepId, reason) =>
          new Promise<{ added: boolean; serverId?: string }>((resolve) => {
            this.sshAdds.set(stepId, (res) => {
              // A server picked on the add card is a pick too — later steps
              // with the "$picked" placeholder should target it.
              if (res.serverId) pickedIds = [res.serverId];
              resolve(res);
            });
            this.broadcast({
              type: "sshAddRequest",
              messageId: asstMsg.id,
              stepId,
              reason,
            });
            this.notifier.notify(
              "approval",
              "Luno: the agent asks you to add an SSH server.",
            );
          }),
        requestSshPick: (stepId, prompt2, multi) =>
          new Promise<string[]>((resolve) => {
            this.sshPicks.set(stepId, (ids) => {
              pickedIds = ids;
              resolve(ids);
            });
            this.broadcast({
              type: "sshPickRequest",
              messageId: asstMsg.id,
              stepId,
              prompt: prompt2,
              multi,
              servers: this.ssh.list(),
            });
            this.notifier.notify(
              "approval",
              "Luno: the agent asks you to pick an SSH server.",
            );
          }),
      },
      ...this.effectiveApprovalPolicy(settings),
      sshBridge,
    );

    return runner;
  }

  /**
   * [approvalMode, autoApprove] for the current turn. Local and full-access
   * remote turns use the user's settings. A PROJECT-scoped remote turn gets a
   * hardened policy: no auto mode, no per-tool auto-approve, no command
   * allow-list — every mutating tool (Bash/Write/Edit/sshExec) stops at the
   * approval gate and waits for an explicit tap. This is what makes "project"
   * scope real: file tools are workspace-bound by construction, and anything
   * that could escape (shell, SSH) needs the human. Wants a file from another
   * project? The agent runs `cp /other/file .` and the user approves that one
   * visible command.
   */
  private effectiveApprovalPolicy(
    settings: LunoSettings,
  ): [LunoSettings["approvalMode"], LunoSettings["autoApprove"]] {
    const hardened =
      this.turnOrigin.kind === "remote" && this.turnOrigin.scope === "project";
    if (!hardened) return [settings.approvalMode, settings.autoApprove];
    return [
      "ask",
      {
        ...settings.autoApprove,
        writeFiles: false,
        applyEdits: false,
        runCommands: false,
        sshCommands: false,
        allowedCommands: [],
      },
    ];
  }

  /**
   * Whether this turn should fire the parallel title call (webchat/CLI
   * pattern: the tiny title request races the answer, it never waits for it).
   * Only once per session, Claude models only, and only when the message has
   * substance — a bare greeting carries no topic, so the fallback (truncated
   * first user message) stays and the next turn re-checks. The ticket is
   * consumed here (pre-flight) and released on failure in
   * applyGeneratedTitle so a later turn retries.
   */
  private shouldGenerateTitle(message: string, model: string): boolean {
    const sid = this.activeSessionId;
    // sid is undefined on the FIRST turn (session is created in `finally`) —
    // that's the normal title moment, so undefined must pass the gate.
    if (sid && this.titledSessions.has(sid)) return false;
    if (this.pendingTitle) return false; // one in flight at a time
    if (inferModelBrand(model) !== "anthropic") return false;
    if (!hasTitleSubstance(message)) return false;
    this.pendingTitle = true;
    return true;
  }

  /** Await the parallel title call and rename the session it raced. Runs
   *  after autosave (the session id exists by then). Best-effort: a miss
   *  releases the ticket so a later turn can retry. */
  private async applyGeneratedTitle(
    titlePromise: Promise<string | undefined>,
  ): Promise<void> {
    const sid = this.activeSessionId;
    try {
      const title = await titlePromise;
      if (!title || !sid) return;
      this.titledSessions.add(sid);
      await this.sessions.rename(sid, title);
      this.pushState();
    } catch {
      // Best-effort — fallback title stays; ticket released below.
    } finally {
      this.pendingTitle = false;
    }
  }

  // --- refresh helpers -------------------------------------------------------

  private async onAuthChange(): Promise<void> {
    if (!this.auth.isAuthed) this.usageBar.showSignedOut();
    else await this.refreshUsage();
    this.pushState();
  }

  private async refreshModels(): Promise<void> {
    this.providers = await this.providerStore.list();
    const all: ModelInfo[] = [];
    let anyOnline = false;
    let nonLogging = true;

    // Aggregate models from every provider that has what it needs (Luno uses
    // the session key; custom providers need their own stored key).
    for (const p of this.providers) {
      const key =
        p.builtin && p.kind === "luno"
          ? this.auth.apiKey
          : await this.providerStore.getKey(p.id);
      // The built-in Luno provider lists models even when signed out (public
      // catalogue); other providers are skipped until a key is present.
      if (!p.builtin && !key) continue;
      try {
        const { models, nonLogging: nl } = await this.gateway.listModels(
          {
            id: p.id,
            endpoint: p.endpoint,
            kind: p.kind,
            format: p.format ?? "openai-v1",
            key,
          },
          (modelId) => this.providerStore.formatForModel(p, modelId),
        );
        all.push(...models);
        anyOnline = true;
        if (p.builtin) nonLogging = nl;
      } catch {
        /* provider offline — skip its models */
      }
    }

    this.models = all;
    this.nonLogging = nonLogging;
    if (!all.find((m) => m.id === this.selectedModel) && all[0]) {
      this.selectedModel = all[0].id;
    }
    this.setConn(anyOnline ? "online" : "offline");
    this.pushState();
  }

  /** Resolve which provider serves the given model, with its key and the
   *  effective wire format for this specific model. */
  private async targetForModel(model: string): Promise<ProviderTarget> {
    const info = this.models.find((m) => m.id === model);
    const providerId = info?.providerId ?? "luno";
    const provider =
      this.providers.find((p) => p.id === providerId) ??
      this.providers.find((p) => p.kind === "luno")!;
    const key =
      provider.builtin && provider.kind === "luno"
        ? this.auth.apiKey
        : await this.providerStore.getKey(provider.id);
    return {
      id: provider.id,
      endpoint: provider.endpoint,
      kind: provider.kind,
      format: this.providerStore.formatForModel(provider, model),
      key,
    };
  }

  private async refreshUsage(): Promise<void> {
    try {
      const usage = await this.gateway.getUsage();
      this.lastUsage = usage;
      this.usageBar.update(usage);
      this.broadcast({ type: "usage", usage });
    } catch {
      /* ignore */
    }
  }

  /** Current workspace fingerprint — same derivation as the remote bridge's
   *  workspaceInfo(), so session stamps and device bindings compare equal. */
  workspaceStamp(): { name: string; hash: string } | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    return {
      name: folder.name,
      hash: crypto.createHash("sha256").update(folder.uri.fsPath).digest("hex"),
    };
  }

  /** Whether a stored session belongs to the CURRENT workspace. Used by the
   *  remote bridge to stop project-scoped devices from loading/deleting/
   *  renaming chats of other projects. Un-stamped (pre-migration) sessions
   *  count as foreign — fail closed. */
  isSessionInWorkspace(sessionId: string): boolean {
    const hash = this.workspaceStamp()?.hash;
    if (!hash) return false;
    return this.sessions.get(sessionId)?.workspaceHash === hash;
  }

  private setConn(conn: ConnState): void {
    // Manage the retry loop on EVERY call, not only on state changes — a
    // repeat "offline" (refreshModels failed again) must keep the loop armed.
    if (conn === "offline") this.scheduleConnRetry();
    else this.clearConnRetry();
    if (this.conn === conn) return;
    this.conn = conn;
    this.broadcast({ type: "conn", conn });
  }

  /**
   * "Gateway offline" used to be sticky: one transient network error (stream
   * drop, DNS blip, gateway restart) flipped conn to offline and NOTHING
   * retried — the UI said "no connection" until the user manually hit
   * test/reload or sent a message. Retry listModels on a backoff (5s → 60s
   * cap) until the gateway answers again; refreshModels() itself calls
   * setConn, so recovery clears the loop and failure re-arms it.
   */
  private scheduleConnRetry(): void {
    if (this.connRetryTimer) return; // already armed
    const delay = this.connRetryMs;
    this.connRetryMs = Math.min(this.connRetryMs * 2, 60_000);
    this.connRetryTimer = setTimeout(() => {
      this.connRetryTimer = undefined;
      void this.refreshModels();
    }, delay);
    this.connRetryTimer.unref?.();
  }

  private clearConnRetry(): void {
    if (this.connRetryTimer) {
      clearTimeout(this.connRetryTimer);
      this.connRetryTimer = undefined;
    }
    this.connRetryMs = 5_000;
  }
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Bare greetings/acks in the languages our users actually type — these carry
 *  zero topic, so a title generated from them is meta-noise. */
const GREETING_RE =
  /^(привет|прив|ку|хай|здравствуй(те)?|добрый (день|вечер)|доброе утро|йо|салют|здаров(а|о)?|hi|hello|hey|yo|sup|ola|hola|test|тест|ping|пинг|\.+|\?+|!+)[.!?…\s]*$/i;

/**
 * Whether a user message has enough substance to title the chat from it.
 * Short greetings and one-worders wait — the fallback (truncated message)
 * stays until a later turn brings actual topic.
 */
function hasTitleSubstance(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 8) return false;
  if (GREETING_RE.test(t)) return false;
  // At least two words — a single token ("привееееет", "ok?") isn't a topic.
  return t.split(" ").filter(Boolean).length >= 2;
}

/** Image/PDF media types Claude accepts as native content blocks. */
const ATTACHMENT_TYPES: Record<string, { kind: "image" | "pdf"; mime: string }> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  pdf: { kind: "pdf", mime: "application/pdf" },
};

/** ~4.5MB base64 (Claude's request-size territory) — bigger files should be
 *  referenced by path, not inlined. */
const MAX_ATTACHMENT_BYTES = 3_500_000;

/** Read a picked file as an attachment when it's an image/PDF small enough to
 *  inline; undefined means "treat as a path reference instead". */
async function tryReadAttachment(
  uri: vscode.Uri,
): Promise<ChatAttachment | undefined> {
  const ext = uri.path.split(".").pop()?.toLowerCase() ?? "";
  const spec = ATTACHMENT_TYPES[ext];
  if (!spec) return undefined;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return undefined;
    const b64 = Buffer.from(bytes).toString("base64");
    const name = uri.path.split(/[\\/]/).pop() ?? "attachment";
    return { kind: spec.kind, name, dataUrl: `data:${spec.mime};base64,${b64}` };
  } catch {
    return undefined;
  }
}

/** Any other file → a text attachment card (webchat parity): extracted text +
 *  path + line/byte counts. Binary or oversized files are skipped. */
async function tryReadFileAttachment(
  uri: vscode.Uri,
  root: vscode.Uri | undefined,
): Promise<ChatAttachment | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return undefined;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const name = uri.path.split(/[\\/]/).pop() ?? "file";
    return {
      kind: "file",
      name,
      text,
      path: root ? vscode.workspace.asRelativePath(uri, false) : uri.fsPath,
      bytes: bytes.byteLength,
      lines: text.length ? text.split("\n").length : 0,
    };
  } catch {
    // fatal decoder threw → binary file; or unreadable. Either way, skip.
    return undefined;
  }
}
