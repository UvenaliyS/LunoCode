import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { ConfigStore } from "./configStore";
import type { SshServerInput, SshServerMeta, SshTestResult } from "./types";
import { sshProbe } from "./sshService";

/** Secret Storage key for a server's credentials. The value is JSON
 *  {secret, passphrase?} so both auth methods share one slot. */
const SECRET_PREFIX = "luno.ssh.";

/**
 * SSH server registry with a hard metadata/credential split — the security
 * invariant of the whole subsystem. Metadata (SshServerMeta) lives in the
 * shared luno.json via ConfigStore and is what the model, webview and exports
 * see. Credentials live ONLY in OS Secret Storage keyed by server id and are
 * fetched just-in-time inside the extension host to open a connection; nothing
 * in this class ever returns them alongside metadata.
 */
export class SshStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: ConfigStore,
  ) {
    // Metadata can also change under us (hand-edit of luno.json, import) —
    // forward those so the SSH settings tab re-renders.
    context.subscriptions.push(
      config.onDidChange(() => this._onDidChange.fire()),
    );
  }

  list(): SshServerMeta[] {
    return this.config.get("ssh");
  }

  get(id: string): SshServerMeta | undefined {
    return this.list().find((s) => s.id === id);
  }

  /** Add or update a server. Metadata goes to luno.json; the secret (if
   *  provided) goes straight to Secret Storage and is never echoed back. */
  async upsert(input: SshServerInput): Promise<SshServerMeta> {
    const name = input.name?.trim();
    const host = input.host?.trim();
    const username = input.username?.trim();
    if (!name) throw new Error("Server name is required");
    if (!host) throw new Error("Host is required");
    if (!username) throw new Error("Username is required");
    const port = input.port ?? 22;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be an integer between 1 and 65535");
    }

    const existing = input.id ? this.get(input.id) : undefined;
    // A brand-new server without a secret would be permanently unusable, so
    // fail loudly here rather than at first exec.
    if (!existing && !input.secret) {
      throw new Error("A password or private key is required for a new server");
    }

    const meta: SshServerMeta = {
      id: existing?.id ?? input.id ?? randomUUID(),
      name,
      host,
      port,
      username,
      auth: input.auth,
      // createdAt is "when the user added it" — editing must not reset it.
      createdAt: existing?.createdAt ?? Date.now(),
    };

    if (input.secret) {
      await this.context.secrets.store(
        SECRET_PREFIX + meta.id,
        JSON.stringify({
          secret: input.secret,
          passphrase: input.passphrase || undefined,
        }),
      );
    }
    // On edit with the secret omitted, the stored one is intentionally kept —
    // that's how the webview edits a server without ever seeing the credential.

    const rest = this.list().filter((s) => s.id !== meta.id);
    await this.config.update("ssh", [...rest, meta]);
    this._onDidChange.fire();
    return meta;
  }

  /** Remove the server AND its credential — no orphaned secrets. */
  async remove(id: string): Promise<void> {
    await this.context.secrets.delete(SECRET_PREFIX + id);
    await this.config.update(
      "ssh",
      this.list().filter((s) => s.id !== id),
    );
    this._onDidChange.fire();
  }

  /**
   * Fetch the credential for a connection attempt. Host-side use only: the
   * result must go straight into sshService and never into tool output,
   * prompts, logs or webview messages.
   */
  async getSecret(
    id: string,
  ): Promise<{ secret: string; passphrase?: string } | undefined> {
    const raw = await this.context.secrets.get(SECRET_PREFIX + id);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as { secret?: unknown; passphrase?: unknown };
      if (typeof parsed.secret !== "string") return undefined;
      return {
        secret: parsed.secret,
        passphrase:
          typeof parsed.passphrase === "string" ? parsed.passphrase : undefined,
      };
    } catch {
      return undefined; // corrupted entry — treat as missing
    }
  }

  /** Probe the server (connect + trivial exec). Never throws — failures come
   *  back as {ok:false, error} so the UI can just render the result. */
  async test(id: string): Promise<SshTestResult> {
    const meta = this.get(id);
    if (!meta) {
      return { ok: false, error: "Server not found", testedAt: Date.now() };
    }
    const creds = await this.getSecret(id);
    if (!creds) {
      return {
        ok: false,
        error: "No stored credentials — edit the server and re-enter them",
        testedAt: Date.now(),
      };
    }
    return sshProbe(meta, creds);
  }
}
