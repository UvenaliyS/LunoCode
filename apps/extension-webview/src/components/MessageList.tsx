import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Check, ClockCountdown, X, File } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ChatMode, ConnState, ModelInfo } from "../contracts";
import { AgentSteps } from "./AgentSteps";
import { AttachmentPreview } from "./AttachmentPreview";
import { EmptyState } from "./EmptyState";
import { modelBrand } from "./ModelIcon";
import type { PendingSshAdd, PendingSshPick } from "../useLunoState";
import type { QueuedPrompt } from "../App";

interface Props {
  messages: ChatMessage[];
  conn: ConnState;
  models: ModelInfo[];
  pendingApproval?: { messageId: string; stepId: string };
  onApprove: (stepId: string, approved: boolean, allowPattern?: string) => void;
  pendingSshAdd?: PendingSshAdd;
  pendingSshPick?: PendingSshPick;
  onSshAddResolve?: (stepId: string, added: boolean, serverId?: string) => void;
  onSshPickResolve?: (stepId: string, serverIds: string[]) => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  /** Prompts parked while a turn streams; sent one-by-one when it ends. */
  queue?: QueuedPrompt[];
  onRemoveQueued?: (id: string) => void;
  /** Localized divider label for user-stopped turns (from chatStrings). */
  stoppedLabel: string;
  /** Localized waiting label ("Thinking" / "Думаю") shown before first token. */
  workingLabel: string;
}

/** Full display name from a model id — never the raw id (e.g. "Claude Opus 4.8").
 *  Guards against a double "Claude" when the label already carries the brand. */
function fullModelName(models: ModelInfo[], id?: string): string {
  if (!id) return "";
  const m = models.find((x) => x.id === id);
  if (!m) return id;
  if (modelBrand(m).key !== "anthropic") return m.label;
  return /^claude\b/i.test(m.label) ? m.label : `Claude ${m.label}`;
}

/** "1h 12m 59s" — descending units, leading zeros dropped, days max. */
function formatElapsed(ms: number): string {
  let s = Math.round(ms / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

export function MessageList({
  messages,
  conn,
  models,
  pendingApproval,
  onApprove,
  pendingSshAdd,
  pendingSshPick,
  onSshAddResolve,
  onSshPickResolve,
  mode,
  onModeChange,
  queue = [],
  onRemoveQueued,
  stoppedLabel,
  workingLabel,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const countRef = useRef(messages.length);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Track whether the user is parked at the bottom. If they scroll up to read
  // mid-stream we stop auto-following; scrolling back to the bottom re-arms it.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Follow the stream to the bottom by pinning scrollTop directly, in a layout
  // effect (before paint) — so a rapid-fire chunk stream never shows the jump
  // that scrollIntoView() produces. A NEW message (send / reply) always yanks
  // to the bottom and re-arms follow, even if the user had scrolled up; further
  // stream chunks only follow while still pinned.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > countRef.current;
    countRef.current = messages.length;
    if (grew) pinnedRef.current = true;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, queue.length]);

  function copy(id: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    });
  }

  if (messages.length === 0) {
    return <EmptyState mode={mode} onModeChange={onModeChange} conn={conn} />;
  }

  return (
    <div className="messages" ref={scrollRef} onScroll={onScroll}>
      {messages.map((m) => (
        <Bubble
          key={m.id}
          message={m}
          models={models}
          copied={copiedId === m.id}
          onCopy={copy}
          pendingStepId={
            pendingApproval?.messageId === m.id
              ? pendingApproval.stepId
              : undefined
          }
          onApprove={onApprove}
          pendingSshAdd={
            pendingSshAdd?.messageId === m.id ? pendingSshAdd : undefined
          }
          pendingSshPick={
            pendingSshPick?.messageId === m.id ? pendingSshPick : undefined
          }
          onSshAddResolve={onSshAddResolve}
          onSshPickResolve={onSshPickResolve}
          stoppedLabel={stoppedLabel}
          workingLabel={workingLabel}
        />
      ))}

      {queue.length > 0 && (
        <div className="queued-list" aria-label="Queued messages">
          {queue.map((q) => (
            <div className="queued-item" key={q.id} title={q.text}>
              <ClockCountdown size={13} />
              <span className="queued-item-text">{q.text}</span>
              <span className="queued-badge">Queued</span>
              {onRemoveQueued && (
                <button
                  className="queued-x"
                  title="Remove from queue"
                  onClick={() => onRemoveQueued(q.id)}
                >
                  <X size={11} weight="bold" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  message,
  models,
  copied,
  onCopy,
  pendingStepId,
  onApprove,
  pendingSshAdd,
  pendingSshPick,
  onSshAddResolve,
  onSshPickResolve,
  stoppedLabel,
  workingLabel,
}: {
  message: ChatMessage;
  models: ModelInfo[];
  copied: boolean;
  onCopy: (id: string, text: string) => void;
  pendingStepId?: string;
  onApprove: (stepId: string, approved: boolean, allowPattern?: string) => void;
  pendingSshAdd?: PendingSshAdd;
  pendingSshPick?: PendingSshPick;
  onSshAddResolve?: (stepId: string, added: boolean) => void;
  onSshPickResolve?: (stepId: string, serverIds: string[]) => void;
  stoppedLabel: string;
  workingLabel: string;
}) {
  if (message.role === "user") {
    const attachments = message.attachments ?? [];
    const contextPaths = message.contextPaths ?? [];
    return (
      <div className="msg msg-user">
        <div className="user-turn">
          {attachments.length > 0 && (
            <div className="luno-attach-row luno-attach-row-sent">
              {attachments.map((a, i) => (
                <AttachmentPreview key={`${a.name}-${i}`} attachment={a} />
              ))}
            </div>
          )}
          {contextPaths.length > 0 && (
            <div className="context-chips context-chips-sent">
              {contextPaths.map((p) => (
                <span className="context-chip" key={p} title={p}>
                  <File size={11} weight="fill" />
                  <span className="context-chip-name">{userBasename(p)}</span>
                </span>
              ))}
            </div>
          )}
          {message.content.length > 0 && (
            <div className="user-bubble">{message.content}</div>
          )}
        </div>
      </div>
    );
  }

  const hasContent = message.content.length > 0;
  const hasSteps = !!message.steps && message.steps.length > 0;
  const hasBlocks = !!message.blocks && message.blocks.length > 0;
  const model = message.model
    ? models.find((x) => x.id === message.model)
    : undefined;
  const ModelGlyph = model ? modelBrand(model).Icon : undefined;
  const streaming = !!message.streaming;
  // Turn start — fixed on first render of this bubble, so the timer counts
  // continuously from the request across the pre-stream → streaming handoff
  // (each ternary branch mounts a fresh LiveElapsed, so it needs the anchor).
  const startedRef = useRef(Date.now());
  // Pre-stream: nothing yet (no content, no steps) — a dedicated waiting row
  // "(model icon) Working…" left + raw seconds pinned right. No copy button,
  // no model name: those belong to the answer meta bar below.
  const preStream = streaming && !hasContent && !hasSteps;
  // A stop with nothing produced renders ONLY the centered divider.
  const stoppedEmpty = !!message.stopped && !hasContent && !hasSteps;
  // The answer meta bar (copy · model · timer, all left-aligned) appears once
  // something streamed. While streaming it reserves bottom space
  // (msg-meta-live) so the growing text never shoves it under the composer.
  const showMeta = !preStream && !stoppedEmpty && (streaming || hasContent || hasSteps);

  // Stopped with nothing on screen: no avatar, no meta — just the divider.
  if (stoppedEmpty) {
    return (
      <div className="msg msg-assistant">
        <div className="assistant-body">
          <div className="msg-stopped" role="status">
            <span className="msg-stopped-line" />
            <span className="msg-stopped-text">{stoppedLabel}</span>
            <span className="msg-stopped-line" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      <span className="msg-avatar">
        {ModelGlyph ? <ModelGlyph size={24} /> : null}
      </span>
      <div className="assistant-body">
        {preStream ? (
          // Waiting for the first token: "(icon is the avatar) Working…" on
          // the left, plain seconds counter pinned right (no dot separator).
          <div className="msg-meta msg-meta-waiting">
            <span className="msg-working-text">{workingLabel}</span>
            <LiveElapsed className="msg-elapsed-right" since={startedRef.current} />
          </div>
        ) : (
          <>
            {hasBlocks ? (
              // Chronological feed: render text and tool steps in the exact order
              // the model emitted them (text → tool → text …), never all tools
              // hoisted above all text.
              message.blocks!.map((b, i) => {
                if (b.kind === "text") {
                  return b.text ? (
                    <div className="markdown" key={`t${i}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
                    </div>
                  ) : null;
                }
                const step = message.steps?.find((s) => s.id === b.stepId);
                if (!step) return null;
                return (
                  <AgentSteps
                    key={`s${b.stepId}`}
                    steps={[step]}
                    pendingStepId={pendingStepId}
                    onApprove={onApprove}
                    pendingSshAdd={pendingSshAdd}
                    pendingSshPick={pendingSshPick}
                    onSshAddResolve={onSshAddResolve}
                    onSshPickResolve={onSshPickResolve}
                  />
                );
              })
            ) : (
              // Legacy fallback (old sessions saved before blocks existed): steps
              // first, then the whole text.
              <>
                {hasSteps && (
                  <AgentSteps
                    steps={message.steps!}
                    pendingStepId={pendingStepId}
                    onApprove={onApprove}
                    pendingSshAdd={pendingSshAdd}
                    pendingSshPick={pendingSshPick}
                    onSshAddResolve={onSshAddResolve}
                    onSshPickResolve={onSshPickResolve}
                  />
                )}
                {hasContent && (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}
              </>
            )}

            {showMeta && (
              // Answer meta bar: copy · model · elapsed, all left-aligned.
              <div className={`msg-meta${streaming ? " msg-meta-live" : ""}`}>
                <button
                  className="msg-copy"
                  title="Copy answer"
                  disabled={!hasContent}
                  onClick={() => onCopy(message.id, message.content)}
                >
                  {copied ? (
                    <Check size={13} weight="bold" className="msg-copy-ok" />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
                {message.model && (
                  <span className="msg-model">{fullModelName(models, message.model)}</span>
                )}
                {streaming ? (
                  <LiveElapsed className="msg-elapsed" prefix="· " since={startedRef.current} />
                ) : (
                  message.elapsedMs != null && (
                    <span className="msg-elapsed">· {formatElapsed(message.elapsedMs)}</span>
                  )
                )}
              </div>
            )}

            {message.stopped && (
              // Partial answer kept above; the divider marks where it ended.
              <div className="msg-stopped" role="status">
                <span className="msg-stopped-line" />
                <span className="msg-stopped-text">{stoppedLabel}</span>
                <span className="msg-stopped-line" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A seconds/minutes counter. Counts from `since` (the turn's start) when *  given, so it stays continuous across the pre-stream → streaming handoff;
 *  otherwise from mount. */
function LiveElapsed({
  className,
  prefix = "",
  since,
}: {
  className?: string;
  prefix?: string;
  since?: number;
}) {
  const startRef = useRef(since ?? Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <span className={className}>
      {prefix}
      {formatElapsed(Math.max(0, now - startRef.current))}
    </span>
  );
}

/** Last path segment of a context file path, for the compact chip label. */
function userBasename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
