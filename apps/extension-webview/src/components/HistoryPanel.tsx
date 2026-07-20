import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ClockCounterClockwise,
  Trash,
  PencilSimple,
  Check,
  X,
  Plus,
} from "@phosphor-icons/react";
import { navigate, post } from "../vscodeApi";
import type { ChatSessionMeta, ExtensionToWebview } from "../contracts";
import { ct, historyMeta, setChatLang } from "../chatStrings";

/**
 * Local chat history. Lists saved sessions; clicking one loads it into the
 * active chat in-place (no jump to a brand-new chat — that was the Kilo Code
 * annoyance we're avoiding). Supports rename and delete.
 */
export function HistoryPanel() {
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draftTitle, setDraftTitle] = useState("");
  /** Bumped on every state push so a language change re-renders strings. */
  const [, setLangTick] = useState(0);

  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionToWebview>) {
      if (event.data.type === "sessions") {
        setSessions(event.data.sessions);
        setActiveId(event.data.activeId);
      } else if (event.data.type === "state") {
        // The host pushes full state to every webview; we only need language.
        setChatLang(event.data.state);
        setLangTick((t) => t + 1);
      }
    }
    window.addEventListener("message", onMessage);
    post({ type: "listSessions" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const now = Date.now();

  function commitRename(id: string) {
    const t = draftTitle.trim();
    if (t) post({ type: "renameSession", id, title: t });
    setEditingId(undefined);
  }

  return (
    <div className="history">
      <div className="history-inner">
        <div className="history-bar">
          <button
            className="btn-icon"
            title={ct("backToChat")}
            onClick={() => navigate("chat")}
          >
            <ArrowLeft size={16} weight="bold" />
          </button>
          <h1>{ct("historyTitle")}</h1>
          <button
            className="btn-icon"
            title={ct("newChat")}
            onClick={() => {
              post({ type: "newChat" });
              navigate("chat");
            }}
          >
            <Plus size={16} weight="bold" />
          </button>
        </div>

        {sessions.length === 0 ? (
          <div className="history-empty muted">
            <ClockCounterClockwise size={34} />
            <span>{ct("historyEmpty")}</span>
          </div>
        ) : (
          <ul className="history-list">
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`history-item${s.id === activeId ? " active" : ""}`}
              >
                {editingId === s.id ? (
                  <div className="history-rename">
                    <input
                      className="text-input"
                      value={draftTitle}
                      autoFocus
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(s.id);
                        if (e.key === "Escape") setEditingId(undefined);
                      }}
                    />
                    <button
                      className="btn-icon"
                      title={ct("save")}
                      onClick={() => commitRename(s.id)}
                    >
                      <Check size={14} weight="bold" />
                    </button>
                    <button
                      className="btn-icon"
                      title={ct("cancel")}
                      onClick={() => setEditingId(undefined)}
                    >
                      <X size={14} weight="bold" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="history-open"
                      onClick={() => post({ type: "loadSession", id: s.id })}
                    >
                      <span className="history-title">{s.title}</span>
                      <span className="history-meta muted">
                        {historyMeta(s.messageCount, s.updatedAt, now)}
                      </span>
                    </button>
                    <div className="history-actions">
                      <button
                        className="btn-icon"
                        title={ct("rename")}
                        onClick={() => {
                          setEditingId(s.id);
                          setDraftTitle(s.title);
                        }}
                      >
                        <PencilSimple size={14} />
                      </button>
                      <button
                        className="btn-icon danger"
                        title={ct("delete")}
                        onClick={() => post({ type: "deleteSession", id: s.id })}
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
