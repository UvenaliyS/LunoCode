import * as vscode from "vscode";
import type { LunoController } from "./controller";
import { buildWebviewHtml } from "./webviewHtml";
import type { ExtensionToWebview, ViewKind, WebviewToExtension } from "./types";

/** Thin sidebar host: renders the chat screen and relays messages to the
 * shared controller. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "luno.chatView";

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: LunoController,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
      ],
    };
    view.webview.html = buildWebviewHtml(
      view.webview,
      this.context.extensionUri,
      "chat",
    );

    const detach = this.controller.attach((msg) =>
      view.webview.postMessage(msg),
    );
    view.webview.onDidReceiveMessage((m: WebviewToExtension) =>
      this.controller.handle(m),
    );
    view.onDidDispose(() => {
      detach();
      this.view = undefined;
    });
  }

  /** Reveal the sidebar and switch it to the given screen in-place. */
  async show(screen: ViewKind): Promise<void> {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
    const msg: ExtensionToWebview = { type: "navigate", view: screen };
    void this.view?.webview.postMessage(msg);
  }
}
