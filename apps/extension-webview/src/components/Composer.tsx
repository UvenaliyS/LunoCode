import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Stop,
  ChatDots,
  Paperclip,
  X,
  File,
} from "@phosphor-icons/react";
import { AgentIcon } from "./AgentIcon";
import { ct } from "../chatStrings";
import { ModelPicker } from "./ModelPicker";
import { UsageRing } from "./UsageRing";
import { AttachmentPreview } from "./AttachmentPreview";
import type {
  ChatAttachment,
  ChatMode,
  ConnState,
  ModelInfo,
  Provider,
  UsageSnapshot,
} from "../contracts";

interface Props {
  onSend: (text: string, mode: ChatMode, contextPaths: string[]) => void;
  onStop: () => void;
  onAddContext: () => void;
  streaming: boolean;
  /** Files the user has queued as context (relative paths). */
  contextPaths: string[];
  onRemoveContext: (path: string) => void;
  /** Binary attachments (images/PDF) with preview chips. */
  attachments: ChatAttachment[];
  onAddAttachment: (att: ChatAttachment) => void;
  onRemoveAttachment: (index: number) => void;
  models: ModelInfo[];
  selectedModel?: string;
  onSelectModel: (model: string) => void;
  providers?: Provider[];
  conn: ConnState;
  usage?: UsageSnapshot;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  /** Externally-applied draft text (chat switch / restore); nonce forces
   *  re-application even when the text is identical. */
  draftApply?: { text: string; nonce: number };
  /** Live draft persistence — called (debounced upstream) as the user types. */
  onDraftChange?: (text: string) => void;
}

export function Composer({
  onSend,
  onStop,
  onAddContext,
  streaming,
  contextPaths,
  onRemoveContext,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  models,
  selectedModel,
  onSelectModel,
  providers,
  conn,
  usage,
  mode,
  onModeChange,
  draftApply,
  onDraftChange,
}: Props) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const attachRowRef = useRef<HTMLDivElement>(null);

  // Apply an external draft (chat switch, restart restore, send-error
  // restore). Keyed on the nonce so identical text still re-applies.
  useEffect(() => {
    if (!draftApply) return;
    setText(draftApply.text);
    requestAnimationFrame(() => autosize());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftApply?.nonce]);

  // Vertical wheel → horizontal scroll over the attachment row (same trick as
  // the chat tabs strip), so no Ctrl/Shift gymnastics needed.
  function onAttachWheel(e: React.WheelEvent) {
    const el = attachRowRef.current;
    if (!el || e.deltaY === 0) return;
    el.scrollLeft += e.deltaY;
  }

  // Grow from 2 lines up to a max (CSS caps at 11 lines, then scrolls).
  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function submit() {
    const trimmed = text.trim();
    // Sending while streaming is allowed — App queues it (Queued badge).
    if (!trimmed) return;
    // App's onSend clears the persisted draft (immediate, not debounced) —
    // scheduling another save here would race it with stale attachments.
    onSend(trimmed, mode, contextPaths);
    setText("");
    const el = taRef.current;
    if (el) el.style.height = "auto";
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  /** Ctrl+V an image (or a PDF file) straight into the composer. */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      const isImage = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf";
      if (!isImage && !isPdf) continue;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        onAddAttachment({
          kind: isPdf ? "pdf" : "image",
          name: file.name || (isPdf ? "pasted.pdf" : "pasted-image.png"),
          dataUrl: reader.result,
        });
      };
      reader.readAsDataURL(file);
    }
  }

  const hasChips = contextPaths.length > 0;
  const hasAttachments = attachments.length > 0;

  return (
    <div className="composer">
      <div className="composer-box">
        {hasAttachments && (
          <div className="luno-attach-row" ref={attachRowRef} onWheel={onAttachWheel}>
            {attachments.map((a, i) => (
              <AttachmentPreview
                key={`${a.name}-${i}`}
                attachment={a}
                onRemove={() => onRemoveAttachment(i)}
              />
            ))}
          </div>
        )}

        {hasChips && (
          <div className="context-chips">
            {contextPaths.map((p) => (
              <span className="context-chip" key={p} title={p}>
                <File size={11} weight="fill" />
                <span className="context-chip-name">{basename(p)}</span>
                <button
                  className="context-chip-x"
                  title="Remove"
                  onClick={() => onRemoveContext(p)}
                >
                  <X size={10} weight="bold" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input + fixed send button (always top-right). */}
        <div className="composer-input-row">
          <textarea
            ref={taRef}
            className="composer-input"
            placeholder={ct("composerPlaceholder")}
            value={text}
            rows={2}
            onChange={(e) => {
              setText(e.target.value);
              autosize();
              onDraftChange?.(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />

          {streaming && !text.trim() ? (
            <button className="send-btn stop" title="Stop" onClick={onStop}>
              <Stop size={14} weight="fill" />
            </button>
          ) : (
            <button
              className="send-btn"
              title={streaming ? "Queue message (Enter)" : "Send (Enter)"}
              disabled={!text.trim()}
              onClick={submit}
            >
              <ArrowUp size={15} weight="bold" />
            </button>
          )}
        </div>

        {/* Bottom row: paperclip · usage · model on the left, mode on the right. */}
        <div className="composer-toolbar">
          <button
            className="tool-btn"
            title="Attach files (images & PDFs inline; other files by reference)"
            onClick={onAddContext}
          >
            <Paperclip size={16} weight="bold" />
          </button>

          {usage && <UsageRing usage={usage} />}

          <ModelPicker
            models={models}
            selected={selectedModel}
            conn={conn}
            onSelect={onSelectModel}
            providers={providers}
            bare
            openUp
          />

          <span className="composer-spacer" />

          <div
            className={`mode-toggle mode-${mode}`}
            role="tablist"
            aria-label="Chat mode"
          >
            <span className="mode-slider" aria-hidden="true" />
            <button
              role="tab"
              aria-selected={mode === "chat"}
              className={`mode-tab${mode === "chat" ? " active" : ""}`}
              onClick={() => onModeChange("chat")}
            >
              <ChatDots size={12} weight="fill" />
              <span className="mode-tab-label">Chat</span>
            </button>
            <button
              role="tab"
              aria-selected={mode === "agent"}
              className={`mode-tab${mode === "agent" ? " active" : ""}`}
              onClick={() => onModeChange("agent")}
            >
              <AgentIcon size={12} />
              <span className="mode-tab-label">Agent</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
