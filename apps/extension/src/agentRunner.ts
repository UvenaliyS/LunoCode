import { randomUUID } from "node:crypto";
import * as tools from "./agentTools";
import type {
  AgentStep,
  ApprovalMode,
  AutoApproveSettings,
  SshServerMeta,
  ToolCall,
  ToolName,
} from "./types";
import { MUTATING_TOOLS } from "./types";

/**
 * Decide whether a mutating tool call may skip the approval gate. Pure so it can
 * be unit-tested. `approvalMode === "auto"` approves everything; otherwise each
 * tool consults its own auto-approve flag, and runCommand additionally matches
 * the command against the allow-list of trusted prefixes.
 */
export function shouldAutoApprove(
  name: ToolName,
  input: Record<string, unknown>,
  approvalMode: ApprovalMode,
  cfg: AutoApproveSettings,
): boolean {
  if (approvalMode === "auto") return true;
  switch (name) {
    // CC names:
    case "Write":
    case "writeFile":
      return cfg.writeFiles;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "applyEdit":
      return cfg.applyEdits;
    case "sshExec":
      return cfg.sshCommands;
    case "Bash":
    case "runCommand": {
      if (cfg.runCommands) return true;
      const cmd = String(input.command ?? "").trim();
      // Compound commands (a; b && c | d) auto-approve only when EVERY part
      // does — "pwd; rm -rf x" must not ride in on pwd's ticket.
      const parts = cmd
        .split(/(?:&&|\|\||[;|])/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) return false;
      return parts.every((part) =>
        cfg.allowedCommands.some((p) => commandMatches(part, p)),
      );
    }
    default:
      return false;
  }
}

/**
 * Match a command against an allow-list pattern. Case-insensitive. `*` is a
 * wildcard matching any run of characters, so "npm run *" covers "npm run
 * build" / "npm run test:unit", and "git *" covers every git subcommand. A
 * bare prefix with no "*" still matches by prefix (backwards-compatible), so
 * "npm test" auto-approves "npm test --watch".
 */
export function commandMatches(command: string, pattern: string): boolean {
  const cmd = command.trim().toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (!pat) return false;
  if (!pat.includes("*")) {
    // Prefix match on a WORD boundary: "cat" approves "cat x" and "cat",
    // never "catastrophe.exe".
    if (!cmd.startsWith(pat)) return false;
    const next = cmd.charAt(pat.length);
    return next === "" || /\s/.test(next);
  }
  // Build a regex: escape everything, turn \* into .*, anchor at the start.
  const rx = new RegExp(
    "^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"),
  );
  return rx.test(cmd);
}

/** A planned step from the model/gateway: thinking text or a tool to run. */
export interface PlannedStep {
  kind: "thinking" | "tool";
  title: string;
  tool?: ToolName;
  input?: Record<string, unknown>;
}

/** Events the runner emits so the controller can stream them to the webview. */
export interface AgentEvents {
  onStep(step: AgentStep): void;
  onStepUpdate(stepId: string, patch: Partial<AgentStep>): void;
  onOutput(stepId: string, delta: string): void;
  /** Resolve true to run a gated tool, false to reject it. */
  requestApproval(stepId: string): Promise<boolean>;
  /** Interactive sshAdd: resolves once the user added (and picked) a server,
   *  or cancelled. serverId is set when they selected the new server on the
   *  card itself, letting the plan proceed without a separate sshPick. */
  requestSshAdd(
    stepId: string,
    reason?: string,
  ): Promise<{ added: boolean; serverId?: string }>;
  /** Interactive sshPick: resolve with the chosen server ids ([] = cancel). */
  requestSshPick(
    stepId: string,
    prompt: string | undefined,
    multi: boolean,
  ): Promise<string[]>;
}

/**
 * What the runner is allowed to know about SSH. Deliberately narrow: metadata
 * and an opaque exec by server id — credentials are resolved inside the bridge
 * (SshStore + Secret Storage) and can never reach the model through here.
 */
export interface SshBridge {
  /** Mirrors settings.sshEnabled; when off, ssh tools refuse to run. */
  enabled: boolean;
  list(): SshServerMeta[];
  exec(
    serverId: string,
    command: string,
    onData: (d: string) => void,
    signal: AbortSignal,
  ): Promise<{ output: string; exitCode?: number }>;
}

/**
 * Executes a planned agent run with observable steps. Read tools run
 * immediately; mutating tools (write/edit/exec, local or SSH) pass through the
 * approval gate unless approvalMode is "auto". Every step's lifecycle is
 * emitted so the UI can render live status, streamed output, and diffs — the
 * Claude Code GUI feel.
 */
export class AgentRunner {
  /** Auto-approvals granted so far this run — bounded by maxAutoApprovals. */
  private autoApprovalsUsed = 0;

  constructor(
    private readonly events: AgentEvents,
    private readonly approvalMode: ApprovalMode,
    private readonly autoApprove: AutoApproveSettings,
    private readonly ssh?: SshBridge,
  ) {}

  async run(plan: PlannedStep[], signal: AbortSignal): Promise<void> {
    this.autoApprovalsUsed = 0;
    for (const planned of plan) {
      if (signal.aborted) return;

      const step: AgentStep = {
        id: randomUUID(),
        kind: planned.kind,
        status: "running",
        title: planned.title,
        tool:
          planned.kind === "tool" && planned.tool
            ? {
                name: planned.tool,
                title: planned.title,
                input: planned.input ?? {},
              }
            : undefined,
      };
      this.events.onStep(step);

      if (planned.kind === "thinking") {
        this.events.onStepUpdate(step.id, { status: "done" });
        continue;
      }

      try {
        await this.runTool(step, signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.events.onStepUpdate(step.id, { status: "error", error: message });
      }
    }
  }

  /**
   * Execute ONE tool the model requested via native tool_use, driving the full
   * step lifecycle (card, approval gate, SSH interactions, output/diff) and
   * returning the result text for the tool_result block. Never throws — a
   * failure comes back as { isError:true } so the model can react. `stepId`
   * ties the UI step to the model's tool_use id so approvals line up.
   */
  async invokeTool(
    name: ToolName,
    input: Record<string, unknown>,
    stepId: string,
    signal: AbortSignal,
  ): Promise<{ output: string; isError?: boolean }> {
    const step: AgentStep = {
      id: stepId,
      kind: "tool",
      status: "running",
      title: titleForTool(name, input),
      tool: { name, title: titleForTool(name, input), input },
    };
    this.events.onStep(step);
    try {
      // Interactive SSH (add/pick) settle their own status and return a summary.
      if (name === "sshAdd" || name === "sshPick") {
        await this.runInteractiveSsh(name, step.tool!, step.id);
        const done = step.tool!;
        return { output: done.output ?? "(done)" };
      }

      if (name === "sshExec") {
        const meta = this.resolveSshServer(String(input.serverId ?? ""));
        step.tool!.sshServers = [meta];
        this.events.onStepUpdate(step.id, { tool: { ...step.tool! } });
      }

      // Approval gate for mutating tools (unless auto-approved within budget).
      if (MUTATING_TOOLS.includes(name)) {
        const limit = this.autoApprove.maxAutoApprovals;
        const budgetLeft = limit === 0 || this.autoApprovalsUsed < limit;
        const auto =
          budgetLeft &&
          shouldAutoApprove(name, input, this.approvalMode, this.autoApprove);
        if (auto) {
          this.autoApprovalsUsed++;
        } else {
          const approved = await this.events.requestApproval(step.id);
          if (!approved) {
            this.events.onStepUpdate(step.id, { status: "rejected" });
            return {
              output: "Tool call rejected by the user.",
              isError: true,
            };
          }
        }
      }

      const result = await this.execute(name, step.tool!, step.id, signal);
      this.events.onStepUpdate(step.id, {
        status: "done",
        tool: {
          ...step.tool!,
          output: result.output,
          diff: result.diff,
          question: result.question,
        },
      });
      return { output: result.output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.events.onStepUpdate(step.id, { status: "error", error: message });
      return { output: message, isError: true };
    }
  }

  private async runTool(step: AgentStep, signal: AbortSignal): Promise<void> {
    const call = step.tool!;
    const name = call.name;

    // Interactive SSH steps resolve through the user (add card / picker), not
    // through the approval gate — they set their own final status.
    if (name === "sshAdd" || name === "sshPick") {
      await this.runInteractiveSsh(name, call, step.id);
      return;
    }

    // sshExec: pin the target server onto the card BEFORE the approval gate so
    // the user approves knowing exactly which host the command will hit.
    if (name === "sshExec") {
      const meta = this.resolveSshServer(String(call.input.serverId ?? ""));
      call.sshServers = [meta];
      this.events.onStepUpdate(step.id, { tool: { ...call } });
    }

    // Gate mutating tools behind approval. A tool may be auto-approved by the
    // per-tool config (or full "auto" mode), but only until maxAutoApprovals is
    // spent — after that the gate re-engages so the user regains control.
    if (MUTATING_TOOLS.includes(name)) {
      const limit = this.autoApprove.maxAutoApprovals;
      const budgetLeft = limit === 0 || this.autoApprovalsUsed < limit;
      const auto =
        budgetLeft &&
        shouldAutoApprove(name, call.input, this.approvalMode, this.autoApprove);
      if (auto) {
        this.autoApprovalsUsed++;
      } else {
        const approved = await this.events.requestApproval(step.id);
        if (!approved) {
          this.events.onStepUpdate(step.id, { status: "rejected" });
          return;
        }
      }
    }

    const result = await this.execute(name, call, step.id, signal);
    this.events.onStepUpdate(step.id, {
      status: "done",
      tool: {
        ...call,
        output: result.output,
        diff: result.diff,
        question: result.question,
      },
    });
  }

  /** sshAdd/sshPick — block on a user interaction and settle the step. */
  private async runInteractiveSsh(
    name: "sshAdd" | "sshPick",
    call: ToolCall,
    stepId: string,
  ): Promise<void> {
    const ssh = this.requireSsh();

    if (name === "sshAdd") {
      const reason =
        typeof call.input.reason === "string" ? call.input.reason : undefined;
      const res = await this.events.requestSshAdd(stepId, reason);
      if (res.added) {
        // When the user picked the new server right on the card, surface it
        // like an sshPick result so downstream steps (and the model) know the
        // target without another round-trip.
        const meta = res.serverId
          ? ssh.list().find((s) => s.id === res.serverId)
          : undefined;
        this.events.onStepUpdate(stepId, {
          status: "done",
          tool: {
            ...call,
            ...(meta ? { sshServers: [meta] } : {}),
            output: meta
              ? `Server added and selected: ${meta.id} — ${meta.name} (${meta.host})`
              : "Server added — call sshList to see it.",
          },
        });
      } else {
        this.events.onStepUpdate(stepId, { status: "rejected" });
      }
      return;
    }

    // sshPick: surface the choices on the card before asking, so the webview
    // can render the picker from the step itself (metadata only, never creds).
    const servers = ssh.list();
    const multi = call.input.multi === true;
    call.sshServers = servers;
    call.sshMulti = multi;
    this.events.onStepUpdate(stepId, { tool: { ...call } });

    const prompt =
      typeof call.input.prompt === "string" ? call.input.prompt : undefined;
    const ids = await this.events.requestSshPick(stepId, prompt, multi);
    if (ids.length > 0) {
      const lines = ids.map((id) => {
        const meta = servers.find((s) => s.id === id);
        return meta ? `${meta.id} — ${meta.name} (${meta.host})` : id;
      });
      this.events.onStepUpdate(stepId, {
        status: "done",
        tool: { ...call, output: lines.join("\n") },
      });
    } else {
      this.events.onStepUpdate(stepId, { status: "rejected" });
    }
  }

  private execute(
    name: ToolName,
    call: ToolCall,
    stepId: string,
    signal: AbortSignal,
  ): Promise<tools.ToolResult> {
    const input = call.input;
    switch (name) {
      // --- Real Claude Code CLI tool names ---
      case "Bash":
        return tools.runCommand(
          String(input.command ?? ""),
          (delta) => this.events.onOutput(stepId, delta),
          signal,
        );
      case "Read":
        return tools.readFile(String(input.file_path ?? input.path ?? ""));
      case "LS":
        return tools.listDir(String(input.path ?? "."));
      case "Write":
        return tools.writeFile(
          String(input.file_path ?? input.path ?? ""),
          String(input.content ?? ""),
        );
      case "Edit":
        return tools.applyEdit(
          String(input.file_path ?? input.path ?? ""),
          String(input.old_string ?? input.oldText ?? ""),
          String(input.new_string ?? input.newText ?? ""),
        );
      case "Glob":
        return tools.glob(String(input.pattern ?? ""));
      case "Grep":
        return tools.grep(
          String(input.pattern ?? ""),
          {
            path: input.path ? String(input.path) : undefined,
            glob: input.glob ? String(input.glob) : undefined,
            caseInsensitive: input["-i"] === true,
            lineNumbers: input["-n"] === true,
            filesOnly: input.output_mode === "files_with_matches",
          },
          signal,
        );
      case "WebFetch":
        return tools.webFetch(String(input.url ?? ""), signal);
      case "WebSearch":
        // Server-side tool: the gateway/model runs the actual search. If it
        // ever reaches the client, answer softly so the turn doesn't stall.
        return Promise.resolve({
          output:
            "(WebSearch is handled server-side; no local action taken.)",
        });
      case "TodoWrite": {
        // Surface the plan as the tool output; the webview renders it as a
        // checklist from the step's input.todos.
        const todos = Array.isArray(input.todos) ? input.todos : [];
        const lines = todos
          .map((t: any) => {
            const mark =
              t?.status === "completed"
                ? "[x]"
                : t?.status === "in_progress"
                  ? "[~]"
                  : "[ ]";
            return `${mark} ${t?.content ?? ""}`;
          })
          .join("\n");
        return Promise.resolve({ output: lines || "(empty todo list)" });
      }
      case "AskUserQuestion": {
        // Parse the input and return structured question for UI rendering.
        const questions = input.questions as any[];
        const q = questions?.[0]; // Take first question (multi-question not yet supported)
        if (!q) {
          return Promise.resolve({
            output: "(no question provided)",
          });
        }
        return Promise.resolve({
          output: q.question || "Question",
          question: {
            header: q.header,
            prompt: q.question,
            options: q.options || [],
          },
        });
      }
      // --- Legacy local-runner dialect (custom providers / old sessions) ---
      case "readFile":
        return tools.readFile(String(input.path ?? ""));
      case "listDir":
        return tools.listDir(String(input.path ?? "."));
      case "writeFile":
        return tools.writeFile(
          String(input.path ?? ""),
          String(input.content ?? ""),
        );
      case "applyEdit":
        return tools.applyEdit(
          String(input.path ?? ""),
          String(input.oldText ?? ""),
          String(input.newText ?? ""),
        );
      case "runCommand":
        return tools.runCommand(
          String(input.command ?? ""),
          (delta) => this.events.onOutput(stepId, delta),
          signal,
        );
      case "sshList": {
        // Soft answer instead of an error so the model learns the state and
        // stops trying, rather than treating it as a transient failure.
        if (!this.ssh?.enabled) {
          return Promise.resolve({
            output: "(SSH subsystem disabled in settings)",
          });
        }
        const servers = this.ssh.list();
        return Promise.resolve({
          output: servers.length
            ? servers
                .map(
                  (s) => `${s.id} — ${s.name} (${s.username}@${s.host}:${s.port})`,
                )
                .join("\n")
            : "(no servers configured)",
        });
      }
      case "sshExec": {
        const ssh = this.requireSsh();
        return ssh
          .exec(
            String(input.serverId ?? ""),
            String(input.command ?? ""),
            (delta) => this.events.onOutput(stepId, delta),
            signal,
          )
          .then((r) => ({ output: r.output }));
      }
      default:
        return Promise.reject(new Error(`Unknown tool: ${name}`));
    }
  }

  /** Non-list ssh tools hard-fail when the subsystem is off or unwired. */
  private requireSsh(): SshBridge {
    if (!this.ssh?.enabled) throw new Error("SSH subsystem is disabled");
    return this.ssh;
  }

  /** Unknown ids happen (model hallucination, deleted server) — fail with a
   *  message that steers the model back to sshList. */
  private resolveSshServer(serverId: string): SshServerMeta {
    const meta = this.requireSsh()
      .list()
      .find((s) => s.id === serverId);
    if (!meta) {
      throw new Error(
        `Unknown SSH server id "${serverId}" — call sshList to see the configured servers.`,
      );
    }
    return meta;
  }

  /** Reset the auto-approval counter at the start of a fresh agent turn. */
  resetAutoApprovals(): void {
    this.autoApprovalsUsed = 0;
  }
}

/** A short human-readable step title for a native tool call. */
function titleForTool(name: ToolName, input: Record<string, unknown>): string {
  const p = (k: string) => (typeof input[k] === "string" ? String(input[k]) : "");
  switch (name) {
    // CC names:
    case "Read":
      return `Read ${p("file_path") || p("path")}`;
    case "LS":
      return `List ${p("path") || "."}`;
    case "Write":
      return `Write ${p("file_path") || p("path")}`;
    case "Edit":
    case "MultiEdit":
      return `Edit ${p("file_path") || p("path")}`;
    case "Bash":
      return p("command") || "Run command";
    case "Glob":
      return `Glob ${p("pattern")}`;
    case "Grep":
      return `Grep ${p("pattern")}`;
    case "WebFetch":
      return `Fetch ${p("url")}`;
    case "WebSearch":
      return `Search: ${p("query")}`;
    case "TodoWrite":
      return "Update todo list";
    case "AskUserQuestion":
      return "Ask user";
    case "NotebookEdit":
      return `Edit notebook ${p("notebook_path")}`;
    case "sshList":
      return "List SSH servers";
    case "sshExec":
      return `SSH: ${p("command")}`;
    // legacy local names:
    case "readFile":
      return `Read ${p("path")}`;
    case "listDir":
      return `List ${p("path") || "."}`;
    case "writeFile":
      return `Write ${p("path")}`;
    case "applyEdit":
      return `Edit ${p("path")}`;
    case "runCommand":
      return p("command") || "Run command";
    default:
      return name;
  }
}
