import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";
import type { SshServerMeta, SshTestResult } from "./types";

/**
 * Thin ssh2 wrapper — the ONLY place in the extension where SSH credentials
 * are ever combined with a host. Callers pass creds explicitly (fetched from
 * Secret Storage by SshStore) and nothing here logs, returns or persists them;
 * only command output and friendly error strings leave this module.
 */

export interface SshExecResult {
  output: string;
  exitCode?: number;
}

export interface SshCreds {
  secret: string;
  passphrase?: string;
}

/** Handshake budget — a host that can't complete auth in 10s is effectively
 *  down for our purposes, and we don't want agent steps hanging. */
const READY_TIMEOUT_MS = 10_000;

/** Default wall-clock budget for one command. The system prompt tells the
 *  model to avoid long-running commands, so 30s is generous. */
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

/** Cap on collected output — it ends up in the model transcript, so an
 *  unbounded `cat` of a huge log must not blow up the context window. */
const OUTPUT_CAP = 200_000;

/** Build the ssh2 connect config for a server + its creds. The meaning of
 *  `secret` depends on the auth method chosen when the server was added. */
function connectConfig(server: SshServerMeta, creds: SshCreds): ConnectConfig {
  const base: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: READY_TIMEOUT_MS,
  };
  return server.auth === "password"
    ? { ...base, password: creds.secret }
    : { ...base, privateKey: creds.secret, passphrase: creds.passphrase };
}

/**
 * Map raw ssh2/network errors to short human phrases. The raw messages leak
 * library internals ("All configured authentication methods failed") and are
 * what the model/user will see, so we translate the common cases.
 */
function friendlyError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (/All configured authentication methods failed/i.test(msg)) {
    return new Error(
      "Authentication failed — check the username and credentials",
    );
  }
  if (code === "ECONNREFUSED" || msg.includes("ECONNREFUSED")) {
    return new Error("Connection refused");
  }
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    /ENOTFOUND|EAI_AGAIN/.test(msg)
  ) {
    return new Error("Host not found");
  }
  // Covers our own "Timed out" plus ssh2's "Timed out while waiting for handshake".
  if (/timed? ?out/i.test(msg)) return new Error("Timed out");
  return err instanceof Error ? err : new Error(msg);
}

/**
 * Connect, run one command, and resolve with combined stdout+stderr (streamed
 * through onData for live UI) plus the exit code. Mirrors agentTools.runCommand
 * so SSH steps render identically to local ones: output ends with "[exit N]".
 */
export function sshExec(
  server: SshServerMeta,
  creds: SshCreds,
  command: string,
  onData?: (chunk: string) => void,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_EXEC_TIMEOUT_MS,
): Promise<SshExecResult> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let output = "";
    let truncated = false;
    let exitCode: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Abort just ends the connection; the resulting stream/connection close
    // then settles the promise (with partial output when the exec started).
    const onAbort = () => client.end();

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // Always tear the connection down — we never keep sessions alive, so a
      // leaked Client can't hold a socket (and creds) around.
      client.end();
    };
    // ssh2 can emit error AND close for one failure; guard double-settle.
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(friendlyError(err));
    };
    const succeed = (result: SshExecResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    if (signal?.aborted) {
      fail(new Error("Aborted"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    timer = setTimeout(() => fail(new Error("Timed out")), timeoutMs);

    // Collect capped (the transcript copy), but stream everything to onData
    // so the live UI still shows the tail of a chatty command.
    const push = (chunk: Buffer | string) => {
      const s = chunk.toString();
      if (!truncated) {
        const room = OUTPUT_CAP - output.length;
        if (s.length > room) {
          output += s.slice(0, Math.max(0, room)) + "\n… (truncated)";
          truncated = true;
        } else {
          output += s;
        }
      }
      onData?.(s);
    };

    client.on("ready", () => {
      client.exec(command, (err, stream) => {
        if (err) {
          fail(err);
          return;
        }
        stream.on("data", push);
        stream.stderr.on("data", push);
        // "exit" is optional per the SSH spec — code stays undefined then.
        stream.on("exit", (code: number | null) => {
          if (typeof code === "number") exitCode = code;
        });
        stream.on("close", () => {
          const tail = `\n[exit ${exitCode ?? "?"}]`;
          onData?.(tail);
          succeed({ output: output + tail, exitCode });
        });
      });
    });
    client.on("error", (err) => fail(err));
    // Safety net: connection dropped before ready/exec ever settled anything.
    client.on("close", () => fail(new Error("Connection closed unexpectedly")));

    try {
      client.connect(connectConfig(server, creds));
    } catch (err) {
      // ssh2 throws synchronously on unparseable private keys.
      fail(err);
    }
  });
}

/**
 * Connectivity probe for the "Test" button / add flow: full connect + a
 * trivial exec, so it exercises auth AND channel setup, not just TCP.
 */
export async function sshProbe(
  server: SshServerMeta,
  creds: SshCreds,
): Promise<SshTestResult> {
  const started = Date.now();
  try {
    await sshExec(server, creds, "echo luno-ok");
    return { ok: true, latencyMs: Date.now() - started, testedAt: Date.now() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      testedAt: Date.now(),
    };
  }
}
