import * as vscode from "vscode";
import type { LunoController } from "./controller";
import { buildWebviewHtml } from "./webviewHtml";
import type { SettingsTabId, WebviewToExtension } from "./types";

/** Manages editor-area webview panels: the "Open in Tab" chat and the
 * "Luno Settings" tab (Kilo-style — settings never take over the sidebar;
 * they open as a normal editor tab that closes like any other). */
export class PanelManager {
  private chatPanel?: vscode.WebviewPanel;
  private settingsPanel?: vscode.WebviewPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: LunoController,
  ) {}

  /** Open (or reveal) the chat as an editor tab. `beside` opens it in the
   *  column to the RIGHT of the active editor (the editor-title toolbar
   *  button); otherwise it opens in the active column. */
  openChatInTab(beside = false): void {
    if (this.chatPanel) {
      this.chatPanel.reveal();
      return;
    }
    this.chatPanel = this.makePanel(
      "luno.chatTab",
      "Luno Code",
      "chat",
      undefined,
      false,
      beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    );
    const detach = this.controller.attach((m) =>
      this.chatPanel?.webview.postMessage(m),
    );
    this.chatPanel.webview.onDidReceiveMessage((m: WebviewToExtension) =>
      this.controller.handle(m),
    );
    this.chatPanel.onDidDispose(() => {
      detach();
      this.chatPanel = undefined;
    });
  }

  /** Open (or reveal) the full settings UI as an editor tab. `tab` deep-links
   *  a specific settings section (e.g. the SSH card sends users to "ssh"). */
  openSettingsInTab(tab?: SettingsTabId): void {
    if (this.settingsPanel) {
      this.settingsPanel.reveal();
      if (tab) {
        void this.settingsPanel.webview.postMessage({
          type: "navigate",
          view: "settings",
          settingsTab: tab,
        });
      }
      return;
    }
    this.settingsPanel = this.makePanel(
      "luno.settingsTab",
      "Luno Settings",
      "settings",
      tab,
      true, // locked: this editor tab must always show settings, never chat
    );
    const detach = this.controller.attach((m) =>
      this.settingsPanel?.webview.postMessage(m),
    );
    this.settingsPanel.webview.onDidReceiveMessage((m: WebviewToExtension) =>
      this.controller.handle(m),
    );
    this.settingsPanel.onDidDispose(() => {
      detach();
      this.settingsPanel = undefined;
    });
  }

  private makePanel(
    id: string,
    title: string,
    view: "chat" | "settings",
    settingsTab?: SettingsTabId,
    locked?: boolean,
    column: vscode.ViewColumn = vscode.ViewColumn.Active,
  ): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      id,
      title,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
        ],
      },
    );
    // `currentColor` in the svg renders BLACK in editor tab strips — supply
    // explicit per-theme icons (white on dark, original on light).
    panel.iconPath = {
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "luno-moon-white.svg",
      ),
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "luno-moon.svg",
      ),
    };
    panel.webview.html = buildWebviewHtml(
      panel.webview,
      this.context.extensionUri,
      view,
      settingsTab,
      locked,
    );
    return panel;
  }
}
