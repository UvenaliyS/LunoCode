import * as vscode from "vscode";
import type { ExtensionToWebview, LunoSettings } from "./types";

export type NotifyEvent = "complete" | "approval" | "error";

/** Suppress a repeat of the identical event fired within this window (ms). */
const DEBOUNCE_MS = 1000;

/**
 * Emits agent notifications through two independent channels:
 *   - the webview (which owns the audio device — the extension host has none),
 *     via a `notify` message, when the `sound` toggle is on;
 *   - an OS toast, only when `osBanner` is on AND the VS Code window is not
 *     focused (a toast while you're staring at the window is just noise).
 *
 * Both channels are gated by the master `enabled` switch and the per-event
 * toggle (onComplete/onApproval/onError). Settings are read lazily on every
 * call so live changes take effect without re-wiring.
 */
export class NotificationService {
  /** Last fired-at timestamp per event, for de-duping bursts. */
  private readonly lastAt: Record<NotifyEvent, number> = {
    complete: 0,
    approval: 0,
    error: 0,
  };

  constructor(
    private readonly getSettings: () => LunoSettings,
    private readonly postToWebview: (msg: ExtensionToWebview) => void,
  ) {}

  notify(event: NotifyEvent, message: string): void {
    const n = this.getSettings().notifications;
    if (!n.enabled) return;
    if (!this.perEventEnabled(event, n)) return;

    const now = Date.now();
    if (now - this.lastAt[event] < DEBOUNCE_MS) return;
    this.lastAt[event] = now;

    // Webview plays the sound — the host has no audio device of its own.
    if (n.sound) this.postToWebview({ type: "notify", event });

    // Only interrupt with an OS banner when the user is looking elsewhere.
    if (n.osBanner && !vscode.window.state.focused) {
      this.showToast(event, message);
    }
  }

  private perEventEnabled(
    event: NotifyEvent,
    n: LunoSettings["notifications"],
  ): boolean {
    switch (event) {
      case "complete":
        return n.onComplete;
      case "approval":
        return n.onApproval;
      case "error":
        return n.onError;
    }
  }

  private showToast(event: NotifyEvent, message: string): void {
    switch (event) {
      case "complete":
        void vscode.window.showInformationMessage(message);
        return;
      case "error":
        void vscode.window.showErrorMessage(message);
        return;
      case "approval": {
        const OPEN = "Open Chat";
        void vscode.window
          .showWarningMessage(message, OPEN)
          .then((choice) => {
            if (choice === OPEN) {
              void vscode.commands.executeCommand("luno.openChat");
            }
          });
        return;
      }
    }
  }
}
