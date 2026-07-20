import { useEffect, useRef, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { useLunoState } from "./useLunoState";
import { post } from "./vscodeApi";
import { Composer } from "./components/Composer";
import { MessageList } from "./components/MessageList";
import { Header } from "./components/Header";
import { DisplayContext } from "./components/DisplayContext";
import { LightboxProvider } from "./components/Lightbox";
import { chatT } from "./chatStrings";
import type { ChatAttachment, ChatMode } from "./contracts";

/** A prompt captured while a turn was still streaming — sent when it ends. */
export interface QueuedPrompt {
  id: string;
  text: string;
  mode: ChatMode;
  paths: string[];
  attachments: ChatAttachment[];
}

export function App() {
  const {
    state,
    messages,
    usage,
    conn,
    error,
    draftApply,
    selectedModel,
    setSelectedModel,
    pendingApproval,
    approveToolCall,
    pendingSshAdd,
    pendingSshPick,
    sshAddResolve,
    sshPickResolve,
    contextPaths,
    removeContext,
    clearContext,
    attachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    clearError,
    sessions,
    activeSessionId,
    openSession,
    closeSession,
    newChat,
    noteFirstUserMessage,
  } = useLunoState();

  const [mode, setMode] = useState<ChatMode>("chat");
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const streaming = messages.some((m) => m.streaming);
  // Ref mirror so the drain effect reads the current queue synchronously.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // Debounced draft persistence: typing streams into host globalState so the
  // draft survives chat switches and full VS Code restarts.
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function persistDraft(textNow: string) {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      post({
        type: "saveDraft",
        sessionId: activeSessionId,
        text: textNow,
        attachments: attachments.length ? attachments : undefined,
        contextPaths: contextPaths.length ? contextPaths : undefined,
      });
    }, 400);
  }

  function dispatch(q: QueuedPrompt) {
    clearError();
    noteFirstUserMessage(q.text);
    post({
      type: "sendPrompt",
      text: q.text,
      model: selectedModel,
      mode: q.mode,
      contextPaths: q.paths.length ? q.paths : undefined,
      attachments: q.attachments.length ? q.attachments : undefined,
    });
  }

  function send(text: string, sendMode: ChatMode, paths: string[]) {
    // The sent draft is spent: cancel the pending debounce and clear the slot
    // BEFORE sendPrompt, so the host can't migrate/restore a stale copy back
    // into the composer after the first turn mints the session id.
    if (draftTimer.current) clearTimeout(draftTimer.current);
    post({ type: "saveDraft", sessionId: activeSessionId, text: "" });
    const item: QueuedPrompt = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      mode: sendMode,
      paths,
      attachments,
    };
    clearContext();
    clearAttachments();
    if (streaming) {
      // A turn is running — park the prompt; the drain effect sends it as
      // soon as the stream ends. Rendered with a Queued badge until then.
      setQueue((p) => [...p, item]);
      return;
    }
    dispatch(item);
  }

  // Drain the queue one prompt per finished turn.
  useEffect(() => {
    if (streaming) return;
    const next = queueRef.current[0];
    if (!next) return;
    setQueue((p) => p.slice(1));
    dispatch(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  function onSelectModel(model: string) {
    setSelectedModel(model);
    post({ type: "selectModel", model });
  }

  return (
    <DisplayContext.Provider value={state.settings.display}>
      <LightboxProvider>
        <div className="app">
        <Header
          sessions={sessions}
          activeSessionId={activeSessionId}
          messages={messages}
          onOpenSession={openSession}
          onCloseSession={closeSession}
          onNewChat={newChat}
          newChatLabel={chatT(state, "newChat")}
        />

        {error && (
          <div className="banner banner-error" onClick={clearError}>
            <WarningCircle size={14} weight="fill" />
            <span>{error}</span>
          </div>
        )}

        <MessageList
          messages={messages}
          conn={conn}
          models={state.models}
          pendingApproval={pendingApproval}
          onApprove={approveToolCall}
          pendingSshAdd={pendingSshAdd}
          pendingSshPick={pendingSshPick}
          onSshAddResolve={sshAddResolve}
          onSshPickResolve={sshPickResolve}
          mode={mode}
          onModeChange={setMode}
          queue={queue}
          onRemoveQueued={(id) => setQueue((p) => p.filter((q) => q.id !== id))}
          stoppedLabel={chatT(state, "stoppedByUser")}
          workingLabel={chatT(state, "thinking")}
        />

        <Composer
          onSend={send}
          onStop={() => post({ type: "stop" })}
          onAddContext={() => post({ type: "addContext" })}
          streaming={streaming}
          contextPaths={contextPaths}
          onRemoveContext={removeContext}
          attachments={attachments}
          onAddAttachment={addAttachment}
          onRemoveAttachment={removeAttachment}
          models={state.models}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          providers={state.providers}
          conn={conn}
          usage={usage}
          mode={mode}
          onModeChange={setMode}
          draftApply={draftApply}
          onDraftChange={persistDraft}
        />
        </div>
      </LightboxProvider>
    </DisplayContext.Provider>
  );
}
