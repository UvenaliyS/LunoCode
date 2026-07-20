import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import { StringDecoder } from "node:string_decoder";
import type { ToolName } from "./types";

/**
 * Agent tools — the concrete filesystem/terminal operations the runner can
 * invoke. Everything is scoped to the first workspace folder; paths are
 * resolved against it and validated so the agent can't escape the workspace.
 * Read tools run freely; write/exec are gated by the runner's approval step,
 * not here (this layer just does the work).
 */

export interface ToolResult {
  /** Text to stream/show as the tool output. */
  output: string;
  /** Unified diff for file-mutating tools, for the approval preview. */
  diff?: string;
  /** AskUserQuestion — structured question object for UI rendering. */
  question?: {
    header?: string;
    prompt: string;
    options: Array<{
      label: string;
      description?: string;
      recommended?: boolean;
      preview?: string;
    }>;
  };
}

function workspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("No workspace folder is open.");
  return folder.uri;
}

/** The OS temp dir, as a URI, with a trailing slash on its path. This is the
 *  second permitted root: `runCommand` runs shell commands whose scratch files
 *  land here (git-bash maps `/tmp` → `%TEMP%`), so the file tools must be able
 *  to read back what the agent's own commands just wrote. */
function tempRoot(): vscode.Uri {
  return vscode.Uri.file(os.tmpdir());
}

/** True if `uri` sits at or under `root` (case-insensitive on Windows). */
function isUnder(uri: vscode.Uri, root: vscode.Uri): boolean {
  const win = process.platform === "win32";
  const norm = (s: string) => (win ? s.toLowerCase() : s);
  const rootPath = norm(root.path.endsWith("/") ? root.path : root.path + "/");
  const rt = norm(root.path);
  const a = norm(uri.path);
  return a === rt || a.startsWith(rootPath);
}

/** Resolve a path (workspace-relative OR absolute) and reject escapes outside
 *  the permitted roots (workspace + OS temp dir). Claude Code sends absolute
 *  file_path values, so accept both. Tolerates the shapes models actually
 *  produce: `//README.md` / `/README.md` (imagined "/" workspace root),
 *  `./src/x`, git-bash `/c/Users/…`, and `/tmp/…` (→ OS temp on Windows). */
function resolve(inputPath: string): vscode.Uri {
  const root = workspaceRoot();
  let p = inputPath.trim();
  // git-bash drive form → native: /c/Users/… → c:/Users/…
  const bashDrive = /^\/([a-zA-Z])\//.exec(p);
  if (bashDrive) p = `${bashDrive[1]}:/${p.slice(3)}`;
  // git-bash /tmp (and /var/tmp) map to the OS temp dir on Windows — the shell
  // writes there, so a bare `/tmp/x` must resolve to %TEMP%\x, not be rejected.
  if (process.platform === "win32") {
    const tmp = /^\/(?:var\/)?tmp(?:\/(.*))?$/.exec(p);
    if (tmp) {
      return vscode.Uri.joinPath(tempRoot(), tmp[1] ?? "");
    }
  }
  // Leading ./ is always workspace-relative noise.
  p = p.replace(/^\.\/+/, "");

  const isDrivePath = /^[a-zA-Z]:[\\/]/.test(p);
  const isPosixAbs = p.startsWith("/") || p.startsWith("\\");
  // On Windows a bare "/foo" (no drive) is a model's imagined workspace root,
  // not a real filesystem location — treat it as workspace-relative.
  const looksAbsolute =
    isDrivePath || (isPosixAbs && process.platform !== "win32");
  if (!looksAbsolute) p = p.replace(/^[\\/]+/, "");

  const uri = looksAbsolute
    ? vscode.Uri.file(p)
    : vscode.Uri.joinPath(root, p);
  // Permitted if it lands in the workspace OR the OS temp dir.
  if (!isUnder(uri, root) && !isUnder(uri, tempRoot())) {
    throw new Error(`Path escapes the workspace: ${inputPath}`);
  }
  return uri;
}

export async function readFile(relPath: string): Promise<ToolResult> {
  const bytes = await vscode.workspace.fs.readFile(resolve(relPath));
  const text = new TextDecoder().decode(bytes);
  // Cap what we surface so a huge file can't blow up the transcript.
  const capped =
    text.length > 20_000 ? text.slice(0, 20_000) + "\n… (truncated)" : text;
  return { output: capped };
}

export async function listDir(relPath: string): Promise<ToolResult> {
  const entries = await vscode.workspace.fs.readDirectory(resolve(relPath || "."));
  const lines = entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, kind]) =>
      kind === vscode.FileType.Directory ? `${name}/` : name,
    );
  return { output: lines.join("\n") || "(empty)" };
}

/** Overwrite (or create) a file. Returns a diff against the prior content. */
export async function writeFile(
  relPath: string,
  content: string,
): Promise<ToolResult> {
  const uri = resolve(relPath);
  const before = await readIfExists(uri);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  return {
    output: `Wrote ${content.length} bytes to ${relPath}`,
    diff: unifiedDiff(relPath, before ?? "", content),
  };
}

/** Replace the first occurrence of oldText with newText in a file. */
export async function applyEdit(
  relPath: string,
  oldText: string,
  newText: string,
): Promise<ToolResult> {
  const uri = resolve(relPath);
  const before = (await readIfExists(uri)) ?? "";
  const idx = before.indexOf(oldText);
  if (idx === -1) {
    throw new Error(`Text to replace was not found in ${relPath}`);
  }
  const after = before.slice(0, idx) + newText + before.slice(idx + oldText.length);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(after));
  return {
    output: `Edited ${relPath}`,
    diff: unifiedDiff(relPath, before, after),
  };
}

/** Common git-bash install locations on Windows, in preference order. */
const GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
];

/** Resolve the shell to run agent commands in. The agent emits POSIX syntax
 *  (`&&`, `ls -la`, `find …`), so on Windows we prefer git-bash when present
 *  and only fall back to PowerShell (with UTF-8 forced) when it isn't. Cached
 *  after the first lookup. */
let cachedShell: { cmd: string; posix: boolean } | undefined;
function pickShell(): { cmd: string; posix: boolean } {
  if (cachedShell) return cachedShell;
  if (process.platform !== "win32") {
    cachedShell = { cmd: "/bin/bash", posix: true };
    return cachedShell;
  }
  const envBash = process.env.LUNO_BASH_PATH; // escape hatch / override
  const bash =
    (envBash && existsSync(envBash) && envBash) ||
    GIT_BASH_CANDIDATES.find((c) => existsSync(c));
  cachedShell = bash
    ? { cmd: bash, posix: true }
    : { cmd: "powershell.exe", posix: false };
  return cachedShell;
}

/**
 * Run a shell command in the workspace root, streaming combined stdout/stderr
 * through onData. Resolves with the full output and exit code appended.
 *
 * Output is UTF-8 throughout: git-bash emits UTF-8 natively; for the PowerShell
 * fallback we force the console + output encoding to UTF-8 so Cyrillic/emoji
 * don't come back as OEM-codepage mojibake. A StringDecoder joins chunks so a
 * multibyte char split across a chunk boundary still decodes cleanly.
 */
export function runCommand(
  command: string,
  onData: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<ToolResult> {
  return new Promise((resolvePromise, reject) => {
    const root = workspaceRoot();
    const { cmd, posix } = pickShell();
    // PowerShell fallback: force UTF-8 for this process before the command runs.
    const psPrefix =
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
      "$OutputEncoding=[Text.Encoding]::UTF8; ";
    const args = posix
      ? ["-lc", command]
      : ["-NoProfile", "-Command", psPrefix + command];
    const child = spawn(cmd, args, {
      cwd: root.fsPath,
      // git-bash on Windows needs a POSIX-y env; forcing UTF-8 locale keeps
      // tool output (and any child processes) in UTF-8.
      env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" },
    });

    let full = "";
    const decoder = new StringDecoder("utf8");
    const push = (b: Buffer) => {
      const s = decoder.write(b);
      if (!s) return;
      full += s;
      onData(s);
    };
    child.stdout.on("data", push);
    child.stderr.on("data", push);

    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      const rest = decoder.end();
      if (rest) {
        full += rest;
        onData(rest);
      }
      const tail = `\n[exit ${code ?? "?"}]`;
      onData(tail);
      resolvePromise({ output: full + tail });
    });
  });
}

/**
 * Fetch a URL and return its text for the model (the CC WebFetch tool).
 * HTML is crudely de-tagged (scripts/styles dropped, tags stripped, entities
 * decoded) — enough for docs pages without shipping a full parser. Output is
 * capped like readFile so a huge page can't blow up the transcript.
 */
export async function webFetch(
  url: string,
  signal?: AbortSignal,
): Promise<ToolResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http/https URLs are supported: ${url}`);
  }
  const timeout = AbortSignal.timeout(30_000);
  const res = await fetch(parsed.href, {
    redirect: "follow",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; LunoCode/1.0)",
      accept: "text/html,application/xhtml+xml,text/plain,application/json,*/*",
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status} for ${parsed.href}`);
  }
  const type = res.headers.get("content-type") ?? "";
  let body = await res.text();
  if (type.includes("html")) {
    body = body
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const capped =
    body.length > 30_000 ? body.slice(0, 30_000) + "\n… (truncated)" : body;
  return { output: capped || "(empty response)" };
}

async function readIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** Minimal line-based unified diff, enough for the approval preview. */
function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  const a = before.length ? before.split("\n") : [];
  const b = after.split("\n");
  const out: string[] = [`--- ${path}`, `+++ ${path}`];
  // Simple LCS-free diff: emit a common prefix/suffix, then a change block.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  for (let i = Math.max(0, start - 2); i < start; i++) out.push(` ${a[i]}`);
  for (let i = start; i <= endA; i++) out.push(`-${a[i]}`);
  for (let i = start; i <= endB; i++) out.push(`+${b[i]}`);
  for (let i = endA + 1; i <= Math.min(a.length - 1, endA + 2); i++)
    out.push(` ${a[i]}`);
  return out.join("\n");
}

/** Whether a tool mutates the workspace / runs code (gated by approval). */
export function isMutating(name: ToolName): boolean {
  return (
    name === "Bash" ||
    name === "Write" ||
    name === "Edit" ||
    name === "MultiEdit" ||
    name === "NotebookEdit" ||
    name === "writeFile" ||
    name === "applyEdit" ||
    name === "runCommand"
  );
}

/** Glob file search via VS Code's workspace index (respects .gitignore). */
export async function glob(
  pattern: string,
  limit = 200,
): Promise<ToolResult> {
  const uris = await vscode.workspace.findFiles(
    pattern,
    "**/node_modules/**",
    limit,
  );
  const root = workspaceRoot();
  const rootPath = root.path.endsWith("/") ? root.path : root.path + "/";
  const rel = uris
    .map((u) => (u.path.startsWith(rootPath) ? u.path.slice(rootPath.length) : u.path))
    .sort();
  return {
    output: rel.length ? rel.join("\n") : "(no files matched)",
  };
}

/**
 * Content search via ripgrep-in-a-shell (fast, respects .gitignore). Falls back
 * to a message if rg isn't on PATH. `filesOnly` mirrors CC's
 * output_mode:"files_with_matches".
 */
export function grep(
  pattern: string,
  opts: {
    path?: string;
    glob?: string;
    caseInsensitive?: boolean;
    lineNumbers?: boolean;
    filesOnly?: boolean;
  },
  signal?: AbortSignal,
): Promise<ToolResult> {
  const args = ["--color=never"];
  if (opts.caseInsensitive) args.push("-i");
  if (opts.lineNumbers && !opts.filesOnly) args.push("-n");
  if (opts.filesOnly) args.push("-l");
  if (opts.glob) args.push("--glob", opts.glob);
  args.push("--", pattern, opts.path || ".");

  return new Promise((resolvePromise) => {
    const root = workspaceRoot();
    const child = spawn("rg", args, { cwd: root.fsPath });
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      err += b.toString();
    });
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", () => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({
        output:
          "ripgrep (rg) is not available. Use Bash with grep instead, or install ripgrep.",
      });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      // rg exits 1 when there are simply no matches — that's not an error.
      const trimmed = out.trim();
      if (trimmed) {
        const capped =
          trimmed.length > 20_000
            ? trimmed.slice(0, 20_000) + "\n… (truncated)"
            : trimmed;
        resolvePromise({ output: capped });
      } else if (code === 1) {
        resolvePromise({ output: "(no matches)" });
      } else {
        resolvePromise({ output: err.trim() || "(no matches)" });
      }
    });
  });
}
