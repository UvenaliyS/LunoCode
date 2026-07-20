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
      (channel?: "telegram" | "web") => auth.login(channel),
    ),
    vscode.commands.registerCommand("luno.logout", async () => {
      await auth.logout();
      void vscode.window.showInformationMessage("Luno: Telegram unlinked.");
    }),
    vscode.commands.registerCommand("luno.showUsage", () =>
      auth.isAuthed ? panels.openSettingsInTab("account") : auth.login(),
    ),
    vscode.commands.registerCommand("luno.buyReset", () => {
      void vscode.window.showInformationMessage(
        "Luno: buy-reset flow coming soon.",
      );
    }),
    vscode.commands.registerCommand("luno.inlineEdit", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      void vscode.window.showInformationMessage(
        "Luno: inline edit coming soon.",
      );
    }),
  );

  console.log("[luno] activated");
}

export function deactivate(): void {
  /* nothing to clean up beyond context.subscriptions */
}
