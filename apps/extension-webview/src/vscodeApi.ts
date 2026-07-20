import type {
  ExtensionToWebview,
  SettingsTabId,
  ViewKind,
  WebviewToExtension,
} from "./contracts";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

// acquireVsCodeApi can only be called once per webview lifetime.
const vscode = window.acquireVsCodeApi?.();

export function post(msg: WebviewToExtension): void {
  vscode?.postMessage(msg);
}

/** Switch the active screen locally, without a round-trip to the extension.
 * Reuses the same `navigate` message the Root listener already handles.
 * `settingsTab` deep-links a specific settings tab (view "settings" only). */
export function navigate(view: ViewKind, settingsTab?: SettingsTabId): void {
  const msg: ExtensionToWebview = { type: "navigate", view, settingsTab };
  window.postMessage(msg, "*");
}
