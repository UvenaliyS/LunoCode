import * as vscode from "vscode";
import type { UsageSnapshot } from "./types";

/**
 * Usage meter in the status bar (spec §4, P0): weekly/monthly remaining in
 * Sonnet-eq. Clicking opens the usage panel / buy-reset flow.
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
    this.item.text = "$(sparkle) Luno Code";
    this.item.tooltip = "Luno Code — click to link Telegram (optional)";
  }

  update(usage: UsageSnapshot): void {
    // The 5-hour window is the one users hit first, so surface it in the bar.
    const five = usage.buckets.find((b) => b.id === "fiveHour");
    const primary = five ?? usage.buckets[0];
    const remaining = primary
      ? Math.max(0, primary.limit - primary.used)
      : 0;
    const pct = primary && primary.limit ? remaining / primary.limit : 0;

    this.item.text = `$(sparkle) ${usage.plan} · ${fmt(remaining)}/${fmt(
      primary?.limit ?? 0,
    )} ${primary?.id === "fiveHour" ? "5h" : "wk"}`;

    this.item.tooltip = new vscode.MarkdownString(
      [
        `**Luno — ${usage.plan}**`,
        "",
        ...usage.buckets.map(
          (b) => `${b.label}: ${fmt(b.used)} / ${fmt(b.limit)} Sonnet-eq`,
        ),
        `Concurrency: ${usage.limits.concurrency} · Priority: x${usage.limits.priority}`,
        "",
        "Click to view details / buy a reset.",
      ].join("\n"),
    );
    // Soft-cap colouring (spec §4: 80/90/100%).
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
