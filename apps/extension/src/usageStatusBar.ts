import * as vscode from "vscode";
import type { UsageSnapshot } from "./types";

/**
 * Usage meter in the status bar (spec §4, P0): "(luno) Luno Code · PLAN ·
 * used/limit" for the 5-hour window. Default status-bar foreground (no brand
 * red — it fought every theme); warning/error backgrounds near the cap.
 *
 * Clicking focuses the sidebar chat and pops the composer's own branded
 * usage panel (the webview `usage-popover`) — VS Code cannot render custom
 * HTML above the status bar, so the popup lives where our styles do.
 */
export class UsageStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "luno.showUsage";
    this.showSignedOut();
    this.item.show();
  }

  showSignedOut(): void {
    this.item.text = "$(luno-moon) Luno Code";
    this.item.tooltip = "Luno Code — click to sign in";
    this.item.backgroundColor = undefined;
  }

  update(usage: UsageSnapshot): void {
    // The 5-hour window is the one users hit first, so surface it in the bar.
    const five = usage.buckets.find((b) => b.id === "fiveHour");
    const primary = five ?? usage.buckets[0];

    const planName = (usage.plan ?? "").toUpperCase();
    const planPart = planName ? ` · ${planName}` : "";

    let counter = "";
    let pct = 1;
    if (primary && primary.limit > 0) {
      const used = Math.max(0, primary.used);
      const remaining = Math.max(0, primary.limit - used);
      pct = remaining / primary.limit;
      counter = ` · ${grouped(used)}/${fmt(primary.limit)}`;
    }
    // Unlimited (admin / -1 limits): brand + plan, no counter.
    this.item.text = `$(luno-moon) Luno Code${planPart}${counter}`;
    this.item.tooltip = `Luno Code — ${planName || "?"} · click for usage`;

    // Theme-native colouring; only warn/error near the cap.
    this.item.backgroundColor =
      pct <= 0
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : pct <= 0.1
          ? new vscode.ThemeColor("statusBarItem.warningBackground")
          : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

/** Thousands-grouped: 1245221 -> "1,245,221" (used side of the counter). */
function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Compact number formatting: 15000000 -> "15M", 11200000 -> "11.2M". */
function fmt(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(n);
}
