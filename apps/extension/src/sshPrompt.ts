import type { SshServerMeta } from "./types";

/**
 * System-prompt block for the SSH subsystem. Injected into agent runs when
 * settings.sshEnabled — it teaches the model the tool workflow and, crucially,
 * states that credentials are unreachable so it never asks users for
 * passwords/keys in chat (the invariant the whole subsystem is built on).
 */
export function buildSshSystemPrompt(servers: SshServerMeta[]): string {
  const serverLines =
    servers.length === 0
      ? "(no servers configured yet)"
      : servers
          .map(
            (s) =>
              `${s.id} — ${s.name} (${s.username}@${s.host}:${s.port}, added ${isoDate(s.createdAt)})`,
          )
          .join("\n");

  return [
    "## SSH subsystem",
    "You can run commands on the user's remote servers via SSH tools: sshList, sshExec, sshAdd, sshPick.",
    "Currently configured servers (id — name, login, date added):",
    serverLines,
    "",
    "Credentials (passwords/private keys) are stored securely on the user's machine and are NEVER accessible to you. Never ask the user to paste a password or key into the chat; connections are authenticated automatically.",
    "",
    "Workflow:",
    "1. Consult the server list above (or call sshList for a fresh copy).",
    "2. If the user's request could match more than one server, call sshPick — the user selects the target(s) interactively (multiple selection is possible).",
    "3. If no suitable server exists, call sshAdd — the user gets an interactive \"Add server\" card that opens the SSH settings tab; wait for it to resolve, then re-check the list.",
    "4. Run commands with sshExec({serverId, command}).",
    "",
    "Commands run non-interactively (no TTY, no prompts) — anything that waits for input will hang until it times out. Prefer idempotent commands. Avoid long-running commands, or background them (e.g. nohup … &).",
  ].join("\n");
}

/** YYYY-MM-DD from unix ms — a full timestamp is noise in a prompt. */
function isoDate(unixMs: number): string {
  return new Date(unixMs).toISOString().slice(0, 10);
}
