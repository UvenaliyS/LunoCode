import { useState } from "react";
import {
  CaretRight,
  CaretDown,
  CircleNotch,
  CheckCircle,
  Circle,
  DotOutline,
  XCircle,
  Lightbulb,
  TerminalWindow,
  FileText,
  FilePlus,
  PencilSimple,
  MagnifyingGlass,
  FileMagnifyingGlass,
  FolderOpen,
  Globe,
  HardDrives,
  ListChecks,
  PlusCircle,
  CheckSquareOffset,
  Blueprint,
  Question,
  Sparkle,
  Notebook,
  type Icon,
} from "@phosphor-icons/react";
import { AgentIcon } from "./AgentIcon";
import { SshAddCard, SshPickCard, SshResolvedLine } from "./SshCards";
import { useDisplay } from "./DisplayContext";
import type { AgentStep, AskOption, TodoItem, ToolCall, ToolName } from "../contracts";
import type { PendingSshAdd, PendingSshPick } from "../useLunoState";
import { ct } from "../chatStrings";

/**
 * Renders an agent turn's observable steps — the Claude Code GUI feel. Thinking
 * is an expandable reasoning block; each tool call (the real CC tools: Bash,
 * Read, Write, Edit, Glob, Grep, TodoWrite, Task, WebFetch, …) is a collapsible
 * block with its own icon, input, streamed output, and (for edits) a diff.
 * TodoWrite renders as a plan checklist; ExitPlanMode as a plan card.
 */
export function AgentSteps({
  steps,
  pendingStepId,
  onApprove,
  pendingSshAdd,
  pendingSshPick,
  onSshAddResolve,
  onSshPickResolve,
}: {
  steps: AgentStep[];
  pendingStepId?: string;
  onApprove: (stepId: string, approved: boolean, allowPattern?: string) => void;
  pendingSshAdd?: PendingSshAdd;
  pendingSshPick?: PendingSshPick;
  onSshAddResolve?: (stepId: string, added: boolean, serverId?: string) => void;
  onSshPickResolve?: (stepId: string, serverIds: string[]) => void;
}) {
  // Keep the last few steps expanded; older ones collapse to keep the turn tidy.
  const RECENT = 3;
  const recentFrom = steps.length - RECENT;
  return (
    <div className="agent-steps">
      {steps.map((step, i) => (
        <StepBlock
          key={step.id}
          step={step}
          defaultOpen={i >= recentFrom}
          awaitingApproval={step.id === pendingStepId}
          onApprove={onApprove}
          pendingSshAdd={
            pendingSshAdd?.stepId === step.id ? pendingSshAdd : undefined
          }
          pendingSshPick={
            pendingSshPick?.stepId === step.id ? pendingSshPick : undefined
          }
          onSshAddResolve={onSshAddResolve}
          onSshPickResolve={onSshPickResolve}
        />
      ))}
    </div>
  );
}

function StepBlock({
  step,
  defaultOpen,
  awaitingApproval,
  onApprove,
  pendingSshAdd,
  pendingSshPick,
  onSshAddResolve,
  onSshPickResolve,
}: {
  step: AgentStep;
  defaultOpen: boolean;
  awaitingApproval: boolean;
  onApprove: (stepId: string, approved: boolean, allowPattern?: string) => void;
  pendingSshAdd?: PendingSshAdd;
  pendingSshPick?: PendingSshPick;
  onSshAddResolve?: (stepId: string, added: boolean, serverId?: string) => void;
  onSshPickResolve?: (stepId: string, serverIds: string[]) => void;
}) {
  const isThinking = step.kind === "thinking";
  const tool = step.tool;
  const isPlan =
    tool?.name === "ExitPlanMode" || tool?.name === "EnterPlanMode";
  const isTodo = tool?.name === "TodoWrite";
  const isAsk = tool?.name === "AskUserQuestion" && !!tool.question;
  const isSshAdd = tool?.name === "sshAdd";
  const isSshPick = tool?.name === "sshPick";
  const sshAddActive = isSshAdd && !!pendingSshAdd && !!onSshAddResolve;
  const sshPickActive = isSshPick && !!pendingSshPick && !!onSshPickResolve;
  // A resolved sshAdd/sshPick shows a compact summary line instead of the card.
  const sshResolved =
    (isSshAdd || isSshPick) &&
    !sshAddActive &&
    !sshPickActive &&
    (step.status === "done" || step.status === "rejected");
  const hasPlainBody = !!(tool?.output || tool?.diff || hasInput(tool?.input));
  // Everything with content is collapsible, including thinking / plan / ask.
  const collapsible =
    (isThinking && !!step.detail) ||
    isTodo ||
    isPlan ||
    isAsk ||
    sshAddActive ||
    sshPickActive ||
    sshResolved ||
    hasPlainBody;

  // Display prefs override the recency default: thinking / tool-output blocks
  // start collapsed when the user asked for a tidier feed. Interactive cards
  // (ask, ssh add/pick awaiting the user) always stay open regardless.
  const display = useDisplay();
  const interactive = isAsk || sshAddActive || sshPickActive;
  const forceCollapsed =
    !interactive &&
    ((isThinking && display.collapseThinking) ||
      (!isThinking && hasPlainBody && display.collapseToolOutput));
  const [open, setOpen] = useState(forceCollapsed ? false : defaultOpen);

  return (
    <div
      className={`agent-step ${isThinking ? "thinking" : "tool"} status-${step.status}`}
    >
      <button
        className="agent-step-head"
        onClick={() => collapsible && setOpen((v) => !v)}
      >
        {collapsible ? (
          open ? (
            <CaretDown size={11} weight="bold" />
          ) : (
            <CaretRight size={11} weight="bold" />
          )
        ) : (
          <span className="agent-step-nocaret" />
        )}
        {isThinking ? (
          <Lightbulb size={13} weight="fill" className="thinking-bulb" />
        ) : (
          <ToolIcon name={tool?.name} />
        )}
        <span className="agent-step-title">
          {isSshAdd
            ? ct("sshAddTitle")
            : isSshPick
              ? ct("sshPickTitle")
              : step.title}
          {tool?.name === "sshExec" && tool.sshServers?.[0]
            ? ` · ${tool.sshServers[0].name} (${tool.sshServers[0].host})`
            : ""}
        </span>
        <StatusIcon status={step.status} />
      </button>

      {open && (
        <>
          {isThinking && step.detail && (
            <div className="agent-step-body">
              <div className="thinking-text">{step.detail}</div>
            </div>
          )}

          {isTodo && tool?.todos && <TodoList todos={tool.todos} />}

          {isPlan && tool?.plan && (
            <div className="agent-plan">
              <pre className="agent-plan-text">{tool.plan}</pre>
            </div>
          )}

          {isAsk && tool?.question && <AskCard question={tool.question} />}

          {sshAddActive && (
            <SshAddCard
              pending={pendingSshAdd!}
              servers={pendingSshAdd!.servers ?? []}
              onResolve={onSshAddResolve!}
            />
          )}

          {sshPickActive && (
            <SshPickCard
              pending={pendingSshPick!}
              // Prefer the request's live list (refreshed by sshServers
              // broadcasts when the user adds a server mid-pick) over the
              // tool's snapshot taken when the step started.
              servers={pendingSshPick!.servers ?? tool?.sshServers ?? []}
              onResolve={onSshPickResolve!}
            />
          )}

          {sshResolved && (
            <SshResolvedLine
              kind={isSshAdd ? "sshAdd" : "sshPick"}
              status={step.status}
              servers={tool?.sshServers}
            />
          )}

          {!isThinking &&
            !isTodo &&
            !isPlan &&
            !isAsk &&
            !sshAddActive &&
            !sshPickActive &&
            !sshResolved &&
            hasPlainBody && (
            <div className="agent-step-body">
              {tool?.diff ? (
                <DiffView diff={tool.diff} />
              ) : (
                hasInput(tool?.input) && (
                  <pre className="agent-io">{formatInput(tool!.input)}</pre>
                )
              )}
              {tool?.output && (
                <pre className="agent-io output">{tool.output}</pre>
              )}
            </div>
          )}
        </>
      )}

      {step.error && <div className="agent-step-error">{step.error}</div>}

      {awaitingApproval && (
        <div className="agent-approval">
          <span className="agent-approval-text">
            Allow {approvalLabel(tool?.name)}?
          </span>
          <div className="agent-approval-actions">
            <button className="btn btn-sm" onClick={() => onApprove(step.id, false)}>
              Reject
            </button>
            {(() => {
              // For commands, offer "Always allow <cmd> *" so this shape never
              // prompts again — persisted to the auto-approve allow-list.
              const pattern = allowPatternFor(tool);
              return pattern ? (
                <button
                  className="btn btn-sm"
                  title={`Auto-approve "${pattern}" from now on`}
                  onClick={() => onApprove(step.id, true, pattern)}
                >
                  Always allow <code className="agent-approval-pat">{pattern}</code>
                </button>
              ) : null;
            })()}
            <button
              className="btn btn-sm btn-success"
              onClick={() => onApprove(step.id, true)}
            >
              Approve
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AskCard({
  question,
}: {
  question: { header?: string; prompt: string; options: AskOption[] };
}) {
  // Default the selection to the recommended option, if any.
  const recIdx = question.options.findIndex((o) => o.recommended);
  const [selected, setSelected] = useState<number | null>(
    recIdx >= 0 ? recIdx : null,
  );
  const [answered, setAnswered] = useState<string | null>(null);
  const [customInputOpen, setCustomInputOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const active = selected != null ? question.options[selected] : undefined;
  const hasPreview = question.options.some((o) => o.preview);

  if (answered) {
    return (
      <div className="agent-ask">
        {question.header && <span className="agent-ask-header">{question.header}</span>}
        <p className="agent-ask-prompt">{question.prompt}</p>
        <div className="agent-ask-answered">
          <CheckCircle size={13} weight="fill" className="agent-ask-answered-ic" />
          {answered}
        </div>
      </div>
    );
  }

  if (customInputOpen) {
    return (
      <div className="agent-ask">
        {question.header && <span className="agent-ask-header">{question.header}</span>}
        <p className="agent-ask-prompt">{question.prompt}</p>

        <div className="agent-ask-custom-wrapper">
          <textarea
            className="agent-ask-custom-input"
            placeholder="What should the agent do instead? Type your custom instructions/answer..."
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            autoFocus
          />
        </div>

        <div className="agent-ask-actions">
          <button
            className="agent-ask-btn-secondary"
            onClick={() => {
              setCustomInputOpen(false);
              setCustomText("");
            }}
          >
            Back to options
          </button>
          <button
            className="agent-ask-confirm"
            disabled={!customText.trim()}
            onClick={() => setAnswered(customText.trim())}
          >
            Confirm answer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-ask">
      {question.header && <span className="agent-ask-header">{question.header}</span>}
      <p className="agent-ask-prompt">{question.prompt}</p>

      <div className={`agent-ask-body${hasPreview ? " with-preview" : ""}`}>
        <div className="agent-ask-options">
          {question.options.map((opt, i) => (
            <button
              key={i}
              className={`agent-ask-opt${selected === i ? " selected" : ""}`}
              onClick={() => setSelected(i)}
            >
              <span className="agent-ask-radio" aria-hidden="true" />
              <span className="agent-ask-opt-main">
                <span className="agent-ask-opt-label">
                  {opt.label}
                  {opt.recommended && (
                    <span className="agent-ask-rec">Recommended</span>
                  )}
                </span>
                {opt.description && (
                  <span className="agent-ask-opt-desc">{opt.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>

        {hasPreview && (
          <div className="agent-ask-preview">
            {active?.preview ? (
              <pre className="agent-ask-preview-box">{active.preview}</pre>
            ) : (
              <span className="agent-ask-preview-empty">
                Select an option to preview
              </span>
            )}
          </div>
        )}
      </div>

      <div className="agent-ask-actions">
        <button
          className="agent-ask-btn-secondary"
          onClick={() => setAnswered("Cancelled")}
        >
          Cancel
        </button>
        <button
          className="agent-ask-btn-secondary"
          onClick={() => setCustomInputOpen(true)}
        >
          Other / Disagree…
        </button>
        <button
          className="agent-ask-confirm"
          disabled={selected == null}
          onClick={() => active && setAnswered(active.label)}
        >
          Confirm answer
        </button>
      </div>
    </div>
  );
}

function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="agent-todos">
      {todos.map((t, i) => (
        <li key={i} className={`agent-todo ${t.status}`}>
          {t.status === "done" ? (
            <CheckCircle size={13} weight="fill" className="todo-ic done" />
          ) : t.status === "active" ? (
            <DotOutline size={15} weight="fill" className="todo-ic active" />
          ) : (
            <Circle size={12} className="todo-ic pending" />
          )}
          <span className="agent-todo-text">{t.text}</span>
        </li>
      ))}
    </ul>
  );
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="agent-diff">
      {diff.split("\n").map((line, i) => {
        const cls = line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")
              ? "meta"
              : "";
        return (
          <div key={i} className={`diff-line ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function StatusIcon({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "running":
      return <CircleNotch size={13} className="spin agent-status" />;
    case "done":
      return <CheckCircle size={13} weight="fill" className="agent-status ok" />;
    case "error":
      return <XCircle size={13} weight="fill" className="agent-status bad" />;
    case "rejected":
      return <XCircle size={13} weight="fill" className="agent-status rejected" />;
  }
}

/** Icon per Claude CLI tool. */
const TOOL_ICON: Record<ToolName, Icon> = {
  Bash: TerminalWindow,
  BashOutput: TerminalWindow,
  KillShell: TerminalWindow,
  Read: FileText,
  Write: FilePlus,
  Edit: PencilSimple,
  MultiEdit: PencilSimple,
  Glob: FileMagnifyingGlass,
  Grep: MagnifyingGlass,
  LS: FolderOpen,
  WebFetch: Globe,
  WebSearch: Globe,
  TodoWrite: ListChecks,
  Task: Sparkle, // overridden below by the brand AgentIcon
  AskUserQuestion: Question,
  Skill: Blueprint,
  SlashCommand: TerminalWindow,
  NotebookEdit: Notebook,
  ExitPlanMode: CheckSquareOffset,
  EnterPlanMode: CheckSquareOffset,
  // local runner dialect:
  readFile: FileText,
  listDir: FolderOpen,
  writeFile: FilePlus,
  applyEdit: PencilSimple,
  runCommand: TerminalWindow,
  // SSH subsystem:
  sshList: HardDrives,
  sshExec: TerminalWindow,
  sshAdd: PlusCircle,
  sshPick: ListChecks,
};

function ToolIcon({ name }: { name?: ToolName }) {
  // Task uses the brand agent glyph — outline variant for tool rows.
  if (name === "Task") return <AgentIcon size={14} filled={false} />;
  const Glyph = name ? TOOL_ICON[name] : FileText;
  return <Glyph size={13} />;
}

function approvalLabel(name?: ToolName): string {
  switch (name) {
    case "Bash":
    case "BashOutput":
    case "KillShell":
    case "SlashCommand":
    case "runCommand":
      return "this command";
    case "sshExec":
      return "this SSH command";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "writeFile":
    case "applyEdit":
      return "this file change";
    case "WebFetch":
    case "WebSearch":
      return "this web request";
    case "Task":
      return "this sub-agent";
    default:
      return "this action";
  }
}

function hasInput(input?: Record<string, unknown>): boolean {
  return !!input && Object.keys(input).length > 0;
}

/**
 * Suggest an allow-list pattern for a command tool, or null for non-commands
 * (file edits shouldn't be blanket-approved by pattern). Takes the first two
 * words + " *" so "npm run build" → "npm run *" (covers every npm script),
 * "git status" → "git *". A single-word command becomes "<word> *".
 */
function allowPatternFor(tool?: ToolCall): string | null {
  if (!tool) return null;
  const isCommand =
    tool.name === "runCommand" ||
    tool.name === "Bash" ||
    tool.name === "sshExec";
  if (!isCommand) return null;
  const cmd = String(tool.input?.command ?? "").trim();
  if (!cmd) return null;
  const words = cmd.split(/\s+/);
  const base = words.slice(0, 2).join(" ");
  return `${base} *`;
}

function formatInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}
