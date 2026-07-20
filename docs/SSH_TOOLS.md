# SSH tools — credentials the model never sees

The SSH subsystem lets the agent reason about and operate on remote servers
**without ever seeing a credential.** Secrets live in OS Secret Storage and are
used only inside the extension host at the moment a command runs. Everything the
model, the webview, the logs, and any paired [Luno App](LUNO_APP.md) can see is
non-secret metadata.

---

## Threat model & the invariant

**Invariant:** the model sees only `SshServerMeta` —
`{ id, name, host, port, username, auth, createdAt }`. It never sees a password,
private key, or passphrase.

- **Storage split.** `SshServerInput` carries the `secret`/`passphrase` from the
  webview to the host in **one message**; the host writes it to Secret Storage
  keyed by server id and **never echoes it back**. The list broadcast
  (`sshServers`) and every tool payload use `SshServerMeta` only.
- **Auth method is visible; the value is not.** `auth: "password" | "privateKey"`
  is metadata the model may reason about ("use the key-based box"); the credential
  behind it is opaque.
- **Nothing in prompts or logs.** Credentials are structurally absent from the
  model context, tool inputs/outputs, transcripts, and the relay stream — there
  is no code path that places them there.
- **Why it matters for Luno App.** Because secrets are never in an `AgentStep` or
  `ChatMessage`, they cannot leak through the phone mirror, which forwards only
  what the editor already renders.

---

## The four tools

| Tool       | Mutating? | What it does                                                             |
| ---------- | :-------: | ------------------------------------------------------------------------ |
| `sshList`  | no        | List known servers (`SshServerMeta[]`) so the model can pick or describe them |
| `sshExec`  | **yes**   | Run a non-interactive command on a chosen server; **approval-gated**     |
| `sshAdd`   | no*       | Ask the user to add a server (interactive) — deep-links to Settings → SSH |
| `sshPick`  | no        | Ask the user to choose server(s) from a card (interactive)               |

\* `sshAdd` mutates nothing itself — the *user* adds the server through the UI.

### Interactive UX

- **`sshAdd`** — the host emits `sshAddRequest { messageId, stepId, reason? }`.
  The webview shows a card that **deep-links to Settings → SSH**
  (`openSettings: { tab: "ssh" }`). After the user saves the server, they press
  **"I added it"**, which sends `sshAddResolve { stepId, added }`; the agent
  re-reads the server list and continues (or handles a cancel).
- **`sshPick`** — the host emits `sshPickRequest { messageId, stepId, prompt?,
  multi, servers }`. The webview renders an **ask-style card**: a single-select
  when `multi` is false, or a **checkbox multi-select** when true. The choice
  returns as `sshPickResolve { stepId, serverIds }`. Selected servers surface on
  the tool step as `ToolCall.sshServers` (with `sshMulti`) — names/hosts only.

---

## Subsystem prompt injection

- Controlled by **Agent settings → `sshEnabled`** (`LunoSettings.sshEnabled`),
  **default ON.**
- When on, the host injects the SSH subsystem prompt **and** the four tools into
  the agent run — teaching the model the tools, the metadata-only contract, and
  the confirm-before-exec discipline.
- **Applies to custom providers too.** The injection is host-side, so a BYO
  `claude-code` / `codex` / `openai-v1` provider gets the same SSH capability and
  the same credential invariant — it is not a Luno-only feature.
- Turning it off removes both the tools and the prompt, so a model with SSH
  disabled cannot even reference the subsystem.

---

## Approval gating

`sshExec` is in `MUTATING_TOOLS`, so it runs through the standard approval gate:

- With `approvalMode: "ask"` (default), an `sshExec` step blocks and raises
  `toolApprovalRequest`; it runs only after `approveToolCall { approved: true }`.
  The approval card shows the **command and the target server** (from
  `ToolCall.sshServers`) — never a credential.
- With `approvalMode: "auto"`, execution proceeds without a prompt. Prod
  guardrails and destructive-command detection (ROADMAP §6) still apply on top.
- Any surface can approve — editor sidebar or a paired phone — but none can
  bypass the gate; it is the same code path everywhere.

---

## Limitations (v1)

- **Non-interactive only.** `sshExec` runs one-shot commands and captures stdout,
  stderr, and exit code. Commands that expect a TTY / interactive prompt (e.g.
  `sudo` password, `ssh` sub-prompts) are not supported — pass non-interactive
  flags (`sudo -n`, `DEBIAN_FRONTEND=noninteractive`, `-y`).
- **30-second timeout.** A command that exceeds the timeout is killed and
  reported as an error; long-lived processes belong in the terminal, not `sshExec`.
- **Output cap.** Captured output is truncated to a bounded size; the tail is
  marked as clipped so neither the model context nor the transcript is flooded.
- **No agent forwarding / port tunnels** in v1 — a single command per invocation
  against a single resolved server.
