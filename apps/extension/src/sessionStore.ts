import * as vscode from "vscode";
import type {
  ChatMessage,
  ChatSession,
  ChatSessionMeta,
  ComposerDraft,
} from "./types";

const KEY = "luno.sessions";
const DRAFTS_KEY = "luno.drafts";
const MAX_SESSIONS = 200;
/** The unsaved fresh chat's draft slot. */
const NEW_CHAT_SLOT = "__new__";

/**
 * Local-only chat history (spec: history stored on the device, like Kilo Code,
 * but without auto-jumping into new chats). Persists to VS Code globalState so
 * sessions survive reloads and are scoped to the user's machine. A backend sync
 * can layer on later without changing this contract.
 */
export class SessionStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private all(): ChatSession[] {
    return this.context.globalState.get<ChatSession[]>(KEY, []);
  }

  private async writeAll(sessions: ChatSession[]): Promise<void> {
    // Newest first; cap the count so globalState can't grow unbounded.
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    await this.context.globalState.update(KEY, sessions.slice(0, MAX_SESSIONS));
  }

  /** Lightweight list for the history view (no message bodies). */
  list(): ChatSessionMeta[] {
    return this.all()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        model: s.model,
        messageCount: s.messages.length,
        preview: firstPrompt(s.messages),
      }));
  }

  get(id: string): ChatSession | undefined {
    return this.all().find((s) => s.id === id);
  }

  /**
   * Persist the current chat. Creates the session on first save, updates it
   * thereafter. Skips empty chats so we don't litter the list. Returns the
   * (possibly newly created) session id.
   */
  async save(
    id: string | undefined,
    messages: ChatMessage[],
    model: string | undefined,
  ): Promise<string | undefined> {
    const persistable = messages.filter((m) => m.role !== "system" && !m.streaming);
    if (persistable.length === 0) return id;

    const sessions = this.all();
    const now = Date.now();

    if (id) {
      const existing = sessions.find((s) => s.id === id);
      if (existing) {
        existing.messages = persistable;
        existing.model = model;
        existing.updatedAt = now;
        // Keep an auto-title fresh until the user renames it.
        if (!existing.titleEdited) existing.title = autoTitle(persistable);
        await this.writeAll(sessions);
        return id;
      }
    }

    const newId = id ?? rid();
    sessions.push({
      id: newId,
      title: autoTitle(persistable),
      createdAt: now,
      updatedAt: now,
      model,
      messages: persistable,
    });
    await this.writeAll(sessions);
    return newId;
  }

  async delete(id: string): Promise<void> {
    await this.writeAll(this.all().filter((s) => s.id !== id));
    await this.saveDraft(id, undefined);
  }

  async rename(id: string, title: string): Promise<void> {
    const sessions = this.all();
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    s.title = title.trim() || s.title;
    s.titleEdited = true;
    await this.writeAll(sessions);
  }

  // --- composer drafts (per chat, survive switches and restarts) ------------

  private drafts(): Record<string, ComposerDraft> {
    return this.context.globalState.get<Record<string, ComposerDraft>>(
      DRAFTS_KEY,
      {},
    );
  }

  getDraft(sessionId: string | undefined): ComposerDraft | undefined {
    return this.drafts()[sessionId ?? NEW_CHAT_SLOT];
  }

  /** Store (or clear, when `draft` is undefined/empty) a chat's draft. */
  async saveDraft(
    sessionId: string | undefined,
    draft: ComposerDraft | undefined,
  ): Promise<void> {
    const all = this.drafts();
    const slot = sessionId ?? NEW_CHAT_SLOT;
    const empty =
      !draft ||
      (!draft.text.trim() &&
        !draft.attachments?.length &&
        !draft.contextPaths?.length);
    if (empty) delete all[slot];
    else all[slot] = draft;
    await this.context.globalState.update(DRAFTS_KEY, all);
  }

  /** The first-turn autosave moves the fresh chat's draft slot onto its new
   *  session id so the draft follows the chat it belongs to. */
  async migrateNewChatDraft(sessionId: string): Promise<void> {
    const all = this.drafts();
    const draft = all[NEW_CHAT_SLOT];
    if (!draft) return;
    delete all[NEW_CHAT_SLOT];
    all[sessionId] = draft;
    await this.context.globalState.update(DRAFTS_KEY, all);
  }
}

function firstPrompt(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  return (first?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function autoTitle(messages: ChatMessage[]): string {
  const p = firstPrompt(messages);
  if (!p) return "New chat";
  return p.length > 48 ? `${p.slice(0, 48)}…` : p;
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
