import * as vscode from "vscode";

/** Build the HTML shell for a Luno webview, rendering the given screen.
 *  `settingsTab` deep-links the settings view to a tab on first paint — the
 *  webview reads window.__LUNO_SETTINGS_TAB__, the same stash `navigate`
 *  messages use. `locked` pins the view so a navigate message can't switch it
 *  away (the "Luno Settings" editor tab must ALWAYS show settings, never chat). */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: "chat" | "settings",
  settingsTab?: string,
  locked?: boolean,
): string {
  const base = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "index.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "index.css"));
  const modelAssetsUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "models"));
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Luno Code</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__LUNO_VIEW__ = ${JSON.stringify(view)};window.__LUNO_SETTINGS_TAB__ = ${JSON.stringify(settingsTab)};window.__LUNO_LOCKED__ = ${JSON.stringify(!!locked)};window.__LUNO_MODEL_ASSETS__ = ${JSON.stringify(`${modelAssetsUri.toString()}/`)};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  let s = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
