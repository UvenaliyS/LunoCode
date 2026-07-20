import { ClockCounterClockwise, Gear, Moon, UserCircle } from "@phosphor-icons/react";
import { navigate, post } from "../vscodeApi";
import { ChatTabs } from "./ChatTabs";
import type { ChatSessionMeta, ChatMessage } from "../contracts";

interface Props {
  sessions: ChatSessionMeta[];
  activeSessionId?: string;
  messages?: ChatMessage[];
  onOpenSession: (id: string) => void;
  onCloseSession: (id: string) => void;
  onNewChat: () => void;
  newChatLabel: string;
}

/**
 * Top bar: brand logo + account/settings on the top row, then a horizontal strip
 * of open chat tabs underneath. Model selection and usage live in the composer.
 */
export function Header({
  sessions,
  activeSessionId,
  messages,
  onOpenSession,
  onCloseSession,
  onNewChat,
  newChatLabel,
}: Props) {
  return (
    <header className="header">
      <div className="header-top">
        <div className="brand">
          <span className="brand-mark">
            <Moon size={22} weight="fill" className="brand-moon" />
          </span>
          <span className="brand-name">Luno Code</span>
        </div>

        <div className="header-actions">
          <button
            className="tg-btn"
            title="Chat history"
            onClick={() => navigate("history")}
          >
            <ClockCounterClockwise size={18} weight="regular" />
          </button>

          <button
            className="tg-btn"
            title="Account"
            onClick={() => post({ type: "openSettings", tab: "account" })}
          >
            <UserCircle size={18} weight="regular" />
          </button>

          <button
            className="tg-btn"
            title="Settings"
            onClick={() => post({ type: "openSettings" })}
          >
            <Gear size={18} weight="regular" />
          </button>
        </div>
      </div>

      <ChatTabs
        sessions={sessions}
        activeId={activeSessionId}
        messages={messages}
        onOpen={onOpenSession}
        onClose={onCloseSession}
        onNew={onNewChat}
        newChatLabel={newChatLabel}
      />
    </header>
  );
}
