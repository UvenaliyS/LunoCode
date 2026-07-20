import { ChatDots } from "@phosphor-icons/react";
import type { ChatMode, ConnState } from "../contracts";
import { AgentIcon } from "./AgentIcon";
import { CoreSphere } from "./CoreSphere";
import { ct, greatForList } from "../chatStrings";

interface Props {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  conn: ConnState;
}

/**
 * First-run / empty chat screen: an auto-rotating red wireframe sphere, a
 * greeting, and the Chat vs Agent mode chooser. Picking a mode here drives the
 * composer and swaps the "Great for" hints below. Mode NAMES (Chat/Agent) are
 * brand terms and stay English; descriptions localize via chatStrings.
 */
export function EmptyState({ mode, onModeChange, conn }: Props) {
  const bullets = greatForList(mode);

  return (
    <div className="messages messages-empty">
      <div className="empty-hero">
        <CoreSphere size={162} />

        <h2 className="empty-title">{ct("emptyTitle")}</h2>
        <p className="empty-sub">{ct("emptySub")}</p>

        <div className="mode-choose" role="tablist" aria-label="Mode">
          <ModeCard
            active={mode === "chat"}
            variant="chat"
            icon={<ChatDots size={18} weight="fill" />}
            title="Chat"
            sub={ct("modeChatSub")}
            onClick={() => onModeChange("chat")}
          />
          <ModeCard
            active={mode === "agent"}
            variant="agent"
            icon={<AgentIcon size={18} />}
            title="Agent"
            sub={ct("modeAgentSub")}
            onClick={() => onModeChange("agent")}
          />
        </div>

        <div className={`great-for great-for-${mode}`} key={mode}>
          <span className="great-for-label">{ct("greatFor")}</span>
          <ul className="great-for-list">
            {bullets.map((item) => (
              <li key={item}>
                <span className="great-for-dot" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {conn === "offline" && (
          <p className="muted offline-note">{ct("offlineNote")}</p>
        )}
      </div>
    </div>
  );
}

function ModeCard({
  active,
  variant,
  icon,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  variant: "chat" | "agent";
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      className={`mode-card mode-card-${variant}${active ? " active" : ""}`}
      onClick={onClick}
    >
      <span className="mode-card-icon">{icon}</span>
      <span className="mode-card-title">{title}</span>
      <span className="mode-card-sub">{sub}</span>
    </button>
  );
}
