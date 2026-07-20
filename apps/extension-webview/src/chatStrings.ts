import type { WebviewState } from "./contracts";

/** Resolve the active UI language from settings (auto → VS Code display lang,
 *  best-effort via navigator). Chat components aren't wrapped in the settings
 *  I18nProvider, so they read strings through here. */
function langOf(state: WebviewState): "en" | "ru" {
  const l = state.settings.language;
  if (l === "ru" || l === "en") return l;
  return sniffLang();
}

function sniffLang(): "en" | "ru" {
  const nav =
    typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "en";
  return nav.startsWith("ru") ? "ru" : "en";
}

/**
 * Module-level current language. Set from every `state` push (useLunoState,
 * HistoryPanel) — so components WITHOUT access to state (Composer, EmptyState,
 * SshCards, AgentSteps) still render the right language via `ct()`. The store
 * survives view switches inside one webview, which is exactly what the
 * History panel needs: it mounts after the initial state push.
 */
let currentLang: "en" | "ru" = sniffLang();

/** Record the active language from a state push. */
export function setChatLang(state: WebviewState): void {
  currentLang = langOf(state);
}

const STRINGS = {
  newChat: { en: "New chat", ru: "Новый чат" },
  historyTitle: { en: "Chat history", ru: "История чатов" },
  backToChat: { en: "Back to chat", ru: "Назад к чату" },
  historyEmpty: {
    en: "No saved chats yet. Your conversations will appear here.",
    ru: "Пока нет сохранённых чатов. Ваши разговоры появятся здесь.",
  },
  rename: { en: "Rename", ru: "Переименовать" },
  delete: { en: "Delete", ru: "Удалить" },
  save: { en: "Save", ru: "Сохранить" },
  cancel: { en: "Cancel", ru: "Отмена" },
  justNow: { en: "just now", ru: "только что" },
  stoppedByUser: { en: "Stopped by user", ru: "Остановлено пользователем" },
  thinking: { en: "Thinking", ru: "Думаю" },
  // Empty state (mode names Chat/Agent are brand terms — NOT translated).
  emptyTitle: { en: "Let's build", ru: "Давайте создавать" },
  emptySub: {
    en: "Plan, search, or build anything",
    ru: "Планируйте, ищите и создавайте что угодно",
  },
  modeChatSub: { en: "Ask & explore", ru: "Спрашивайте и изучайте" },
  modeAgentSub: { en: "Plan, edit & run", ru: "Планирует, правит, запускает" },
  greatFor: { en: "Great for", ru: "Отлично подходит для" },
  offlineNote: {
    en: "Gateway offline — start the backend or check the URL in Settings.",
    ru: "Гейтвей недоступен — запустите бэкенд или проверьте URL в настройках.",
  },
  composerPlaceholder: {
    en: "Ask a question or describe a task...",
    ru: "Задайте вопрос или опишите задачу…",
  },
  // SSH interactive cards.
  sshAddTitle: { en: "Add SSH server", ru: "Добавление SSH-сервера" },
  sshPickTitle: { en: "Pick SSH server", ru: "Выбор SSH-сервера" },
  sshNeeded: { en: "SSH server needed", ru: "Нужен SSH-сервер" },
  sshNeededDesc: {
    en: "The agent needs an SSH server that isn't configured yet.",
    ru: "Агенту нужен SSH-сервер, который ещё не настроен.",
  },
  sshAddServer: { en: "Add server", ru: "Добавить сервер" },
  sshNoServers: {
    en: "No servers yet — add one above, it appears here instantly.",
    ru: "Серверов пока нет — добавьте выше, он сразу появится здесь.",
  },
  sshUseServer: { en: "Use server", ru: "Использовать сервер" },
  sshCredsHint: {
    en: "Credentials stay in OS secret storage — the agent never sees them.",
    ru: "Учётные данные хранятся в защищённом хранилище ОС — агент их не видит.",
  },
  sshSelectOne: { en: "Select a server", ru: "Выберите сервер" },
  sshSelectMany: { en: "Select servers", ru: "Выберите серверы" },
  sshWhich: {
    en: "Which server should the agent use?",
    ru: "Какой сервер использовать агенту?",
  },
  sshCancelled: { en: "cancelled", ru: "отменено" },
  sshServerSelected: { en: "Server selected", ru: "Сервер выбран" },
} as const;

type StringKey = keyof typeof STRINGS;

/** Localized chat-UI string for the CURRENT language (module store). */
export function ct(key: StringKey): string {
  return STRINGS[key][currentLang];
}

/** Localized chat-UI string for an explicit state (legacy call shape). */
export function chatT(state: WebviewState, key: StringKey): string {
  return STRINGS[key][langOf(state)];
}

/** "Use N servers" for the multi-select confirm button. */
export function ctUseServers(n: number): string {
  if (currentLang === "ru") return `Использовать ${n} серв.`;
  return `Use ${n} servers`;
}

/** "N servers selected" for the resolved line. */
export function ctServersSelected(n: number): string {
  if (currentLang === "ru") return `Выбрано серверов: ${n}`;
  return `${n} server${n === 1 ? "" : "s"} selected`;
}

/** Mode-card "Great for" bullet lists (Chat/Agent names stay English). */
export const GREAT_FOR: Record<
  "chat" | "agent",
  { en: string[]; ru: string[] }
> = {
  chat: {
    en: [
      "Understanding a codebase",
      "Explaining errors & concepts",
      "Quick answers, no edits",
    ],
    ru: [
      "Понимание кодовой базы",
      "Объяснение ошибок и концепций",
      "Быстрые ответы без правок",
    ],
  },
  agent: {
    en: [
      "Multi-file changes & refactors",
      "Running commands & tests",
      "Autonomous task execution",
    ],
    ru: [
      "Правки и рефакторинг по многим файлам",
      "Запуск команд и тестов",
      "Автономное выполнение задач",
    ],
  },
};

/** The current language's bullet list for a mode. */
export function greatForList(mode: "chat" | "agent"): string[] {
  return GREAT_FOR[mode][currentLang];
}

/**
 * Localized "N msg · <relative time>" line for the history list. Kept here so
 * the plural/relative wording lives with the other chat strings. `count` is the
 * message count; `ts` the last-updated epoch ms; `now` is passed in so callers
 * control the clock (and tests stay deterministic).
 */
export function historyMeta(count: number, ts: number, now: number): string {
  const msgs = currentLang === "ru" ? pluralMsgRu(count) : `${count} msg`;
  return `${msgs} · ${relTime(ts, now)}`;
}

/** Russian message-count plural: 1 сообщение / 2 сообщения / 5 сообщений. */
function pluralMsgRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word = "сообщений";
  if (mod10 === 1 && mod100 !== 11) word = "сообщение";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    word = "сообщения";
  return `${n} ${word}`;
}

/** Localized short relative time ("5m ago" / "5 мин назад"). */
function relTime(ts: number, now: number): string {
  const lang = currentLang;
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return ct("justNow");
  if (min < 60) return lang === "ru" ? `${min} мин назад` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return lang === "ru" ? `${hr} ч назад` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return lang === "ru" ? `${day} дн назад` : `${day}d ago`;
  return new Date(ts).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US");
}
