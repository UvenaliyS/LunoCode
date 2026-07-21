import * as vscode from "vscode";
import { GatewayClient } from "./gatewayClient";
import { AuthManager } from "./authManager";
import { UsageStatusBar } from "./usageStatusBar";
import { ChatViewProvider } from "./chatViewProvider";
import { LunoController } from "./controller";
import { SessionStore } from "./sessionStore";
import { ProviderStore } from "./providerStore";
import { ConfigStore } from "./configStore";
import { SshStore } from "./sshStore";
import { NotificationService } from "./notifications";
import { PanelManager } from "./panels";
import { RemoteBridge } from "./remoteBridge";
import { readSettings, registerConfigStore } from "./settings";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Config first: everything else (settings facade, providers, ssh) reads
  // from the single luno.json it owns.
  const config = new ConfigStore(context);
  await config.init();
  registerConfigStore(config);

  const gateway = new GatewayClient(readSettings().gatewayUrl);

  const auth = new AuthManager(context, gateway);
  await auth.init();

  const usageBar = new UsageStatusBar();
  context.subscriptions.push(usageBar);

  const sessions = new SessionStore(context);
  const providers = new ProviderStore(context, config, gateway);
  // The built-in Luno provider authenticates with the signed-in account's key
  // (Secret Storage via AuthManager) — otherwise its connection test 401s.
  providers.setAccountKeyResolver(() => auth.apiKey);
  const ssh = new SshStore(context, config);
  const notifier = new NotificationService(
    () => readSettings(),
    (msg) => controller?.broadcastFromService(msg),
  );
  const controller = new LunoController(
    gateway,
    auth,
    usageBar,
    sessions,
    providers,
    config,
    ssh,
    notifier,
  );
  const panels = new PanelManager(context, controller);
  const chatProvider = new ChatViewProvider(context, controller);
  // Settings open as an editor tab ("Luno Settings"), never inside the
  // sidebar — every openSettings path (gear icon, webview deep-links) lands
  // in the panel.
  controller.setSettingsOpener((tab) => panels.openSettingsInTab(tab));

  // Remote control (Telegram WebApp) bridge — a third "poster" on the
  // controller, connected over WSS. Off by default; Settings → Remote.
  const remoteBridge = new RemoteBridge(context, controller);
  controller.setRemoteBridge(remoteBridge);
  context.subscriptions.push({ dispose: () => remoteBridge.dispose() });
  context.subscriptions.push({ dispose: () => auth.dispose() });
  if (readSettings().remote.enabled) remoteBridge.start();

  // Config edits (hand-editing luno.json, imports) may change the gateway URL.
  context.subscriptions.push(
    config.onDidChange(() => {
      gateway.setBaseUrl(readSettings().gatewayUrl);
      remoteBridge.onSettingsChanged();
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewId,
      chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Browser-OAuth callback: the cabinet redirects to
  // vscode://luno.luno/auth?token=…&state=… after the user authorizes.
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path !== "/auth") return;
        const params = new URLSearchParams(uri.query);
        const token = params.get("token");
        const state = params.get("state");
        if (token && state) {
          void auth.completeBrowserOAuth(token, state);
        }
      },
    }),
  );

  // --- Commands --------------------------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand("luno.openChat", () =>
      vscode.commands.executeCommand("luno.chatView.focus"),
    ),
    vscode.commands.registerCommand("luno.newChat", () => {
      controller.newChat();
      void vscode.commands.executeCommand("luno.chatView.focus");
    }),
    vscode.commands.registerCommand("luno.openInTab", () =>
      panels.openChatInTab(),
    ),
    // Editor-title toolbar button (white Luno moon, near "split editor"):
    // opens the chat in a tab in the column to the RIGHT of the active editor.
    vscode.commands.registerCommand("luno.openInEditorTab", () =>
      panels.openChatInTab(true),
    ),
    vscode.commands.registerCommand("luno.openSettings", () =>
      panels.openSettingsInTab(),
    ),
    vscode.commands.registerCommand("luno.openConfig", () =>
      config.openInEditor(),
    ),
    vscode.commands.registerCommand("luno.exportSettings", () =>
      config.exportToFile(),
    ),
    vscode.commands.registerCommand("luno.importSettings", () =>
      config.importFromFile(),
    ),
    vscode.commands.registerCommand("luno.openHistory", () =>
      chatProvider.show("history"),
    ),
    vscode.commands.registerCommand(
      "luno.login",
      // Через controller.handle — там фолбэк на ввод API-ключа, когда прод
      // не отдаёт device-code (404). Прямой auth.login() кидал бы toast.
      (channel?: "telegram" | "web") =>
        controller.handle({ type: "login", channel: channel ?? "telegram" }),
    ),
    vscode.commands.registerCommand("luno.logout", async () => {
      await auth.logout();
      void vscode.window.showInformationMessage("Luno: Telegram unlinked.");
    }),
    vscode.commands.registerCommand("luno.showUsage", async () => {
      // Open the sidebar chat and pop the composer's branded usage panel —
      // our styles live in the webview; the status bar can't host custom HTML.
      await vscode.commands.executeCommand("luno.chatView.focus");
      controller.broadcastFromService({ type: "showUsagePopover" });
    }),
    vscode.commands.registerCommand("luno.buyReset", () => {
      void vscode.window.showInformationMessage(
        "Luno: buy-reset flow coming soon.",
      );
    }),
    vscode.commands.registerCommand("luno.inlineEdit", () => {
      void seedComposerFromSelection(controller, "edit");
    }),
    vscode.commands.registerCommand("luno.chatAboutSelection", () => {
      void seedComposerFromSelection(controller, "chat");
    }),
  );

  console.log("[luno] activated");
}

/**
 * "Chat about this" / "Edit selection": capture the selected code with its
 * file path and line range, pre-fill the chat composer with a reference block,
 * and focus the sidebar. Nothing is sent — the user adds their ask on top.
 */
async function seedComposerFromSelection(
  controller: LunoController,
  intent: "chat" | "edit",
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("Luno: select some code first.");
    return;
  }
  const doc = editor.document;
  const sel = editor.selection;
  const relPath = vscode.workspace.asRelativePath(doc.uri, false);
  const startLine = sel.start.line + 1;
  const endLine = sel.end.line + 1;
  const lineRef = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
  // Cap huge selections so the composer stays usable; the model gets the file
  // reference anyway and can Read the rest.
  let code = doc.getText(sel);
  if (code.length > 6000) code = code.slice(0, 6000) + "\n… (truncated)";
  const lang = doc.languageId || "";
  const header = intent === "edit" ? "Edit this code:" : "";
  const text =
    `${header ? header + "\n" : ""}` +
    `\`${relPath}:${lineRef}\`\n` +
    "```" + lang + "\n" + code + "\n```\n";
  // Focus the sidebar chat first so the webview is alive to receive the seed.
  await vscode.commands.executeCommand("luno.chatView.focus");
  controller.broadcastFromService({ type: "restoreInput", text });
}

export function deactivate(): void {
  /* nothing to clean up beyond context.subscriptions */
}
