# Settings — the single-config model

Luno's settings live in **one JSON file** (`luno.json`), edited through a tabbed
UI or by hand. The philosophy: **one file, no secrets.** Every preference is in
the config; every credential is in the OS keychain.

---

## `luno.json` — one file, no secrets

- **Single source.** All non-secret settings serialize to one `luno.json`
  (`WebviewToExtension: openConfigFile` opens it for hand-editing). It maps 1:1
  to the `LunoSettings` interface in `packages/shared/src/index.ts`.
- **Secrets never land here.** Provider API keys and SSH credentials live in VS
  Code **Secret Storage** (OS keychain), keyed by provider/server id. The config
  only records *that* a key exists (`Provider.hasKey`), never its value — and the
  key is never sent to the webview.
- **Export / import.** `exportConfig` writes the config to a user-picked file
  (secrets excluded); `importConfig` validates and merges one back in. Both
  report via `configTransfer: { op, ok, detail }`.

### Export format

```jsonc
{
  "_meta": { "app": "luno-code", "version": 1 },
  "settings": {
    "defaultModel": "claude-sonnet",
    "approvalMode": "ask",
    "sshEnabled": true,
    "notifications": { "enabled": true, "onComplete": true, /* … */ },
    "language": "en"
  },
  "providers": [
    { "id": "openrouter", "label": "OpenRouter", "endpoint": "https://…",
      "format": "openai-v1", "autoFormat": true, "modelFormats": {} }
    // hasKey / lastTest are runtime-only; secrets are never exported
  ]
}
```

The `_meta.version` gates migrations on import; an unknown version is rejected
rather than silently coerced.

---

## Tabs

| Tab (`SettingsTabId`) | Holds                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `general`             | Default model, stream responses, show Sonnet-eq cost, disclaimer badge, UI language (`en`/`ru`) |
| `providers`           | The provider list — add / edit / delete custom endpoints, per-provider connection test |
| `models`             | Model catalog with brand icons; per-model wire-format override           |
| `agent`               | Approval mode (`ask`/`auto`); SSH subsystem toggle (`sshEnabled`)        |
| `ssh`                 | SSH servers (metadata only) — add / edit / delete / test. See [SSH_TOOLS.md](SSH_TOOLS.md) |
| `app`                 | Luno Remote pairing — QR + deep link to drive the agent from a phone        |
| `notifications`       | `NotificationSettings` — complete / approval / error, sound, OS banner   |
| `account`             | Plan, login/logout, device-code link, buy-reset                          |
| `about`               | Version, links, "Prompts not logged" / non-logging guarantee             |

Deep links jump straight to a tab: `openSettings: { tab: "ssh" }`, e.g. the
`sshAdd` tool routes the user to **Settings → SSH**.

---

## Providers & wire formats

A provider is a `{ endpoint, format, autoFormat, modelFormats }` record. The
**format** decides the request/response shape, the tool environment and the
streaming protocol:

| `ProviderFormat` | Endpoint                    | Environment                                   |
| ---------------- | --------------------------- | --------------------------------------------- |
| `claude-code`    | `/v1/messages` (SSE)        | Anthropic Messages + Claude Code tools (Bash/Read/Write/Edit/…) |
| `codex`          | `/v1/responses` (SSE)       | OpenAI Responses + the Codex environment      |
| `openai-v1`      | `/v1/chat/completions`      | Universal OpenAI Chat Completions; tool loop shaped like Claude Code where possible |

### Auto-detect by brand

With `autoFormat: true`, the format is picked **per model id** from its brand
(`inferModelBrand`):

- `claude-*` / opus / sonnet / haiku → **claude-code**
- `gpt-*` / `o1`/`o3`/`o4` / `codex` → **codex**
- everything else → **openai-v1**

With `autoFormat: false`, the provider's single `format` applies to every model.

### Per-model override

Regardless of auto-detect, any model can be pinned to a specific format via
`setModelFormat: { providerId, modelId, format }` (omit `format` to clear the
override). Overrides are stored in `Provider.modelFormats` and win over
auto-detect. Brand icons (claude / gpt / gemini / grok) are rendered from the
same inferred brand.

---

## Luno endpoint autodetection

When an added endpoint's host matches `*.luno.codes` (`isLunoEndpoint`), the
provider auto-registers as **kind `luno`** instead of `custom`:

- It speaks the **Luno API contract** (`/models`, `/chat` SSE, `/usage`), not a
  raw wire format — so `format` is irrelevant for it.
- It authenticates by **Luno account login** (device-code) *or* a Luno **API
  key**, and unlocks plan/usage metering.

Any other host stays a `custom` provider and must declare a `ProviderFormat`.

---

## Connection testing

Adding or editing a provider triggers an **immediate connection test**
(`testConnection` / `testProvider`); the result returns as `providerTest` and is
cached on the provider as `lastTest` for the list. The probe checks and surfaces:

- **Ping / reachability** — `ok` and the HTTP `status` (200, 401, …).
- **Model listing** — `modelCount`, when the endpoint reports its models.
- **Key validity** — a `401`/`403` surfaces as `error: "Invalid API key"`.
- **Latency** — round-trip `latencyMs`, shown as a badge.

A failing test blocks nothing — the provider is still saved — but the list shows
the last verdict so a mis-typed endpoint or dead key is visible at a glance.
