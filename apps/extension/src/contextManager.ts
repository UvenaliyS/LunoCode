import type { ChatMessage, ContextSettings } from "./types";

/**
 * Context-window management helpers. Kept pure (no vscode / no I/O) so the
 * compaction and pruning logic is unit-testable and side-effect-free at the
 * boundary — the controller owns the actual `this.messages` mutation.
 *
 * The cache-read invariant: Anthropic prompt caching keys on a STABLE message
 * prefix. So both operations here mutate history PERMANENTLY and only at the
 * OLD end — never re-derived per request. A one-time compaction/prune shortens
 * the prefix once; subsequent turns reuse the shortened prefix verbatim, so the
 * cache still hits. Re-summarizing every turn (the naive approach) would move
 * the prefix each time and blow the cache on every request — exactly what we
 * avoid here.
 */

/** Rough token estimate — ~4 chars/token, good enough to drive a threshold. */
export function estimateTokens(messages: Pick<ChatMessage, "content">[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / 4);
}

/** The context window (in tokens) we budget against. Claude models are 200k. */
export const MODEL_CONTEXT_TOKENS = 200_000;

/** True once the estimate crosses the configured % of the model window. */
export function overThreshold(
  messages: Pick<ChatMessage, "content">[],
  thresholdPct: number,
): boolean {
  const budget = (MODEL_CONTEXT_TOKENS * thresholdPct) / 100;
  return estimateTokens(messages) > budget;
}

/** Marker the compaction summary carries, so we never re-summarize a summary. */
export const COMPACT_MARKER = "luno-compacted";

/**
 * Compact the oldest turns into a single summary message when over threshold.
 * Returns a NEW array (caller assigns it back to persist permanently). Keeps
 * the most recent `keepRecent` messages verbatim; everything older collapses
 * into one system-ish note. Idempotent: re-running when already-compacted +
 * still-small is a no-op, so the stable prefix survives across turns.
 */
export function compactMessages(
  messages: ChatMessage[],
  cfg: ContextSettings,
  keepRecent = 6,
): ChatMessage[] {
  if (!cfg.autoCompact) return messages;
  if (messages.length <= keepRecent + 1) return messages;
  if (!overThreshold(messages, cfg.compactThresholdPct)) return messages;

  const head = messages.slice(0, messages.length - keepRecent);
  const tail = messages.slice(messages.length - keepRecent);

  // If the head is already just our summary, there's nothing new to fold in.
  if (head.length === 1 && head[0].content.startsWith(COMPACT_MARKER)) {
    return messages;
  }

  const summaryBody = head
    .map((m) => `${m.role}: ${firstLine(m.content, 200)}`)
    .join("\n");
  const summary: ChatMessage = {
    id: `compact-${head[head.length - 1].id}`,
    role: "user",
    content:
      `${COMPACT_MARKER}\n[Earlier conversation summarized to save context]\n${summaryBody}`,
  };
  return [summary, ...tail];
}

/**
 * Drop stale tool outputs from history to shrink the session/memory footprint.
 * SAFE for the cache: tool outputs live on `steps`, which the streamed request
 * prefix never includes (streamChat sends only role+content) — so pruning them
 * cannot shift the cached prefix. Mutates in place and returns the same array.
 * Keeps outputs on the most recent `keepRecent` messages.
 */
export function pruneOldOutputs(
  messages: ChatMessage[],
  keepRecent = 4,
): ChatMessage[] {
  const cutoff = messages.length - keepRecent;
  for (let i = 0; i < cutoff; i++) {
    const steps = messages[i].steps;
    if (!steps) continue;
    for (const step of steps) {
      if (step.tool?.output && step.tool.output !== PRUNED) {
        step.tool.output = PRUNED;
      }
    }
  }
  return messages;
}

const PRUNED = "[output pruned]";

function firstLine(s: string, max: number): string {
  const line = s.split("\n", 1)[0] ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}
