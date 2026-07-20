import { useEffect, useRef } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type { ChatSessionMeta, ChatMessage } from "../contracts";

interface Props {
  sessions: ChatSessionMeta[];
  activeId?: string;
  messages?: ChatMessage[];
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  newChatLabel: string;
}

/**
 * Horizontal chat tabs strip under the logo. Each open chat is a tab (title +
 * close ×); the active one is highlighted. A trailing + starts a new chat.
 * Overflows horizontally with a hidden scrollbar. Empty chats read "New chat".
 */
export function ChatTabs({ sessions, activeId, messages, onOpen, onClose, onNew, newChatLabel }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Bring the active tab into view (a new tab lands rightmost → scrolls to it).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [activeId, sessions.length]);

  // Turn a vertical wheel into horizontal scroll so the strip is trackpad/mouse
  // friendly without a visible scrollbar.
  function onWheel(e: React.WheelEvent) {
    const el = scrollRef.current;
    if (!el || e.deltaY === 0) return;
    el.scrollLeft += e.deltaY;
  }

  // Generate title from messages when session not yet saved.
  function autoTitle(msgs: ChatMessage[]): string {
    const first = msgs.find((m) => m.role === "user");
    const text = (first?.content ?? "").replace(/\s+/g, " ").trim();
    if (!text) return newChatLabel;
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }

  const hasActiveInList = sessions.some((s) => s.id === activeId);
  const unsavedTitle = !hasActiveInList && messages ? autoTitle(messages) : newChatLabel;

  return (
    <div className="chat-tabs">
      <div className="chat-tabs-scroll" ref={scrollRef} onWheel={onWheel}>
        {/* The current unsaved chat shows as a "New chat" tab when not in the list. */}
        {!hasActiveInList && (
          <div className="chat-tab active" title={unsavedTitle}>
            <span className="chat-tab-title">{unsavedTitle}</span>
            {/* Same × as saved tabs for visual parity, but inert: there is no
                saved session to close yet, so it swallows the click. */}
            <span className="chat-tab-close is-inert" aria-hidden="true">
              <X size={14} weight="bold" />
            </span>
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            ref={s.id === activeId ? activeRef : undefined}
            className={`chat-tab${s.id === activeId ? " active" : ""}`}
            title={s.title}
            onClick={() => onOpen(s.id)}
          >
            <span className="chat-tab-title">{s.title || newChatLabel}</span>
            <button
              className="chat-tab-close"
              title="Close chat"
              onClick={(e) => {
                e.stopPropagation();
                onClose(s.id);
              }}
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        ))}
      </div>
      <button className="chat-tab-new" title={newChatLabel} onClick={onNew}>
        <Plus size={15} weight="bold" />
      </button>
    </div>
  );
}
