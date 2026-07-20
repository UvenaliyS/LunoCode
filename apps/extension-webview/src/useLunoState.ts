import { useEffect, useRef, useState } from "react";
import type {
  ChatAttachment,
  ChatMessage,
  ChatSessionMeta,
  ConnState,
  ExtensionToWebview,
  SshServerMeta,
  UsageSnapshot,
  WebviewState,
} from "./contracts";
import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_AUTO_APPROVE,
  DEFAULT_CONTEXT,
  DEFAULT_DISPLAY,
  DEFAULT_REMOTE,
} from "./contracts";
import { post } from "./vscodeApi";
import { setChatLang } from "./chatStrings";

const EMPTY: WebviewState = {
  authed: false,
  models: [],
  messages: [],
  nonLogging: true,
  conn: "unknown",
  settings: {
    gatewayUrl: "",
    defaultModel: "",
    streamResponses: true,
    showSonnetEqCost: true,
    approvalMode: "ask",
    sshEnabled: true,
    notifications: DEFAULT_NOTIFICATIONS,
    autoApprove: DEFAULT_AUTO_APPROVE,
    context: DEFAULT_CONTEXT,
    display: DEFAULT_DISPLAY,
    remote: DEFAULT_REMOTE,
    language: "en",
  },
};

/** An sshAdd tool call waiting for the user to add a server (or cancel). The
 *  card doubles as a picker, so it carries the live server list too. */
export interface PendingSshAdd {
  messageId: string;
  stepId: string;
  reason?: string;
  servers: SshServerMeta[];
}

/** An sshPick tool call waiting for the user to choose target server(s). */
export interface PendingSshPick {
  messageId: string;
  stepId: string;
  prompt?: string;
  multi: boolean;
  servers: SshServerMeta[];
}

/** Sentinel for "no chat's draft applied yet" (see draftChatRef). */
const UNSET_CHAT = Symbol("unset");

/** Notification blips, synthesized so the webview ships no audio assets. */
function playNotifySound(event: "complete" | "approval" | "error"): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const blip = (
      freq: number,
      at: number,
      dur = 0.15,
      type: OscillatorType = "sine",
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + at + dur,
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur);
    };
    if (event === "complete") {
      // Two ascending blips.
      blip(660, 0, 0.12);
      blip(880, 0.14, 0.16);
    } else if (event === "approval") {
      blip(520, 0, 0.15);
    } else {
      // Low buzz.
      blip(150, 0, 0.2, "sawtooth");
    }
    setTimeout(() => void ctx.close(), 700);
  } catch {
    // Audio is best-effort; never let it break the webview.
  }
}

/** Subscribes to extension messages and exposes the merged webview state. */
export function useLunoState() {
  const [state, setState] = useState<WebviewState>(EMPTY);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usage, setUsage] = useState<UsageSnapshot | undefined>();
  const [conn, setConn] = useState<ConnState>("unknown");
  const [error, setError] = useState<string | undefined>();
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const [pendingApproval, setPendingApproval] = useState<
    { messageId: string; stepId: string } | undefined
  >();
  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sshServers, setSshServers] = useState<SshServerMeta[]>([]);
  const [pendingSshAdd, setPendingSshAdd] = useState<
    PendingSshAdd | undefined
  >();
  const [pendingSshPick, setPendingSshPick] = useState<
    PendingSshPick | undefined
  >();
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  /** Composer draft to apply (chat switch / restart restore / send-error
   *  restore). The nonce forces re-application even for identical text. */
  const [draftApply, setDraftApply] = useState<{ text: string; nonce: number }>(
    { text: "", nonce: 0 },
  );
  // Ref mirrors so actions can read current values synchronously.
  const activeRef = useRef<string | undefined>(undefined);
  const sessionsRef = useRef<ChatSessionMeta[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  /** Which chat the composer currently shows the draft of. The "unset"
   *  sentinel makes the very first state push apply the restart-restored
   *  draft even though active === undefined matches the initial value. */
  const draftChatRef = useRef<string | undefined | symbol>(UNSET_CHAT);
  /** Set by openSession/newChat: the NEXT state push is a real chat switch,
   *  so applying its draft to the composer is legitimate. */
  const switchPendingRef = useRef(false);
  const sshServersRef = useRef<SshServerMeta[]>([]);
  useEffect(() => {
    activeRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    sshServersRef.current = sshServers;
  }, [sshServers]);

  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionToWebview>) {
      const msg = event.data;
      switch (msg.type) {
        case "state": {
          setChatLang(msg.state);
          setState(msg.state);
          setMessages(msg.state.messages);
          setUsage(msg.state.usage);
          setConn(msg.state.conn);
          setSelectedModel(msg.state.selectedModel);
          if (msg.state.sshServers) setSshServers(msg.state.sshServers);
          if (msg.state.sessions) setSessions(msg.state.sessions);
          if (msg.state.activeSessionId !== undefined)
            setActiveSessionId(msg.state.activeSessionId);
          // Restore the persisted draft ONLY when the composer's content
          // legitimately belongs to another chat: the first push after load
          // (restart restore) or an explicit user switch (openSession /
          // newChat set the flag). The silent active-id mint after the first
          // turn (undefined → sid, same conversation) must NOT re-apply —
          // it would clobber whatever the user is typing mid-stream.
          const active = msg.state.activeSessionId;
          const firstPush = draftChatRef.current === UNSET_CHAT;
          if (firstPush || switchPendingRef.current) {
            switchPendingRef.current = false;
            const d = msg.state.draft;
            setDraftApply((p) => ({ text: d?.text ?? "", nonce: p.nonce + 1 }));
            setAttachments(d?.attachments ?? []);
            setContextPaths(d?.contextPaths ?? []);
          }
          draftChatRef.current = active;
          break;
        }
        case "sessions":
          setSessions(msg.sessions);
          setActiveSessionId(msg.activeId);
          break;
        case "messageAppend":
          setMessages((p) => [...p, msg.message]);
          break;
        case "messageChunk":
          setMessages((p) =>
            p.map((m) => {
              if (m.id !== msg.id) return m;
              // Append to the trailing text block, or open a new one if the last
              // block was a tool step — this preserves the text→tool→text order.
              const blocks = [...(m.blocks ?? [])];
              const last = blocks[blocks.length - 1];
              if (last && last.kind === "text") {
                blocks[blocks.length - 1] = {
                  kind: "text",
                  text: last.text + msg.delta,
                };
              } else {
                blocks.push({ kind: "text", text: msg.delta });
              }
              return { ...m, content: m.content + msg.delta, blocks };
            }),
          );
          break;
        case "messageThinking":
          setMessages((p) =>
            p.map((m) =>
              m.id === msg.id
                ? { ...m, thinking: (m.thinking ?? "") + msg.delta }
                : m,
            ),
          );
          break;
        case "messageDone":
          setMessages((p) =>
            p.map((m) =>
              m.id === msg.id
                ? {
                    ...m,
                    streaming: false,
                    sonnetEqCost: msg.sonnetEqCost,
                    elapsedMs: msg.elapsedMs,
                    stopped: msg.stopped,
                  }
                : m,
            ),
          );
          // The turn is over — no interactive card may outlive it (a stop
          // resolves them host-side; this clears the UI mirrors).
          setPendingApproval(undefined);
          setPendingSshAdd(undefined);
          setPendingSshPick(undefined);
          break;
        case "agentStep":
          setMessages((p) =>
            p.map((m) =>
              m.id === msg.messageId
                ? {
                    ...m,
                    steps: [...(m.steps ?? []), msg.step],
                    // Anchor the step in the chronological feed right where it
                    // was emitted (after whatever text preceded it).
                    blocks: [
                      ...(m.blocks ?? []),
                      { kind: "step", stepId: msg.step.id },
                    ],
                  }
                : m,
            ),
          );
          break;
        case "agentStepUpdate":
          setMessages((p) =>
            p.map((m) =>
              m.id === msg.messageId
                ? {
                    ...m,
                    steps: (m.steps ?? []).map((s) =>
                      s.id === msg.stepId ? { ...s, ...msg.patch } : s,
                    ),
                  }
                : m,
            ),
          );
          break;
        case "agentStepOutput":
          setMessages((p) =>
            p.map((m) =>
              m.id === msg.messageId
                ? {
                    ...m,
                    steps: (m.steps ?? []).map((s) =>
                      s.id === msg.stepId && s.tool
                        ? {
                            ...s,
                            tool: {
                              ...s.tool,
                              output: (s.tool.output ?? "") + msg.delta,
                            },
                          }
                        : s,
                    ),
                  }
                : m,
            ),
          );
          break;
        case "toolApprovalRequest":
          setPendingApproval({ messageId: msg.messageId, stepId: msg.stepId });
          break;
        case "sshServers":
          setSshServers(msg.servers);
          // A pick/add card may be open while the user adds a server in
          // Settings — refresh its choices so the new one appears instantly.
          setPendingSshPick((prev) =>
            prev ? { ...prev, servers: msg.servers } : prev,
          );
          setPendingSshAdd((prev) =>
            prev ? { ...prev, servers: msg.servers } : prev,
          );
          break;
        case "sshAddRequest":
          setPendingSshAdd({
            messageId: msg.messageId,
            stepId: msg.stepId,
            reason: msg.reason,
            servers: sshServersRef.current,
          });
          break;
        case "sshPickRequest":
          setPendingSshPick({
            messageId: msg.messageId,
            stepId: msg.stepId,
            prompt: msg.prompt,
            multi: msg.multi,
            servers: msg.servers,
          });
          break;
        case "notify":
          playNotifySound(msg.event);
          break;
        case "contextAdded":
          setContextPaths((p) => [...new Set([...p, ...msg.paths])]);
          break;
        case "attachmentsAdded":
          setAttachments((p) => [...p, ...msg.attachments]);
          break;
        case "restoreInput":
          // Send failed before anything streamed — put the whole input back.
          setDraftApply((p) => ({ text: msg.text, nonce: p.nonce + 1 }));
          setAttachments(msg.attachments ?? []);
          setContextPaths(msg.contextPaths ?? []);
          break;
        case "usage":
          setUsage(msg.usage);
          break;
        case "conn":
          setConn(msg.conn);
          break;
        case "error":
          setError(msg.message);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    post({ type: "listSessions" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return {
    state,
    messages,
    usage,
    conn,
    error,
    draftApply,
    selectedModel,
    setSelectedModel,
    pendingApproval,
    approveToolCall: (
      stepId: string,
      approved: boolean,
      allowPattern?: string,
    ) => {
      setPendingApproval(undefined);
      post({ type: "approveToolCall", stepId, approved, allowPattern });
    },
    sshServers,
    pendingSshAdd,
    sshAddResolve: (stepId: string, added: boolean, serverId?: string) => {
      setPendingSshAdd(undefined);
      post({ type: "sshAddResolve", stepId, added, serverId });
    },
    pendingSshPick,
    sshPickResolve: (stepId: string, serverIds: string[]) => {
      setPendingSshPick(undefined);
      post({ type: "sshPickResolve", stepId, serverIds });
    },
    contextPaths,
    removeContext: (path: string) =>
      setContextPaths((p) => p.filter((x) => x !== path)),
    clearContext: () => setContextPaths([]),
    attachments,
    addAttachment: (att: ChatAttachment) => setAttachments((p) => [...p, att]),
    removeAttachment: (index: number) =>
      setAttachments((p) => p.filter((_, i) => i !== index)),
    clearAttachments: () => setAttachments([]),
    clearError: () => setError(undefined),
    sessions,
    activeSessionId,
    openSession: (id: string) => {
      switchPendingRef.current = true;
      setActiveSessionId(id);
      post({ type: "loadSession", id });
    },
    closeSession: (id: string) => {
      setSessions((p) => p.filter((s) => s.id !== id));
      post({ type: "deleteSession", id });
    },
    newChat: () => {
      // Already on a fresh unsaved chat with nothing typed into the feed →
      // repeated + presses are no-ops (this was the "дёргается" flicker).
      if (activeRef.current === undefined && messagesRef.current.length === 0)
        return;
      // No optimistic fake session: clearing the active id makes ChatTabs'
      // built-in unsaved "New chat" tab render instantly, and the host's
      // state push lands on the exact same element — nothing jumps.
      switchPendingRef.current = true;
      setActiveSessionId(undefined);
      setMessages([]);
      post({ type: "newChat" });
    },
    /** Rename the active tab from the user's first message (until it has a real
     *  title — the host later replaces this with a model-generated one). */
    noteFirstUserMessage: (text: string) => {
      const id = activeRef.current;
      if (!id) return;
      setSessions((p) =>
        p.map((s) =>
          s.id === id && (!s.title || s.title === "New chat")
            ? {
                ...s,
                title: truncateTitle(text),
                preview: text,
                messageCount: s.messageCount + 1,
                updatedAt: Date.now(),
              }
            : s,
        ),
      );
    },
  };
}

/** First line of the message, trimmed to a short tab title with an ellipsis. */
function truncateTitle(text: string, max = 26): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}
