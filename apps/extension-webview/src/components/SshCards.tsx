import { useState } from "react";
import {
  CheckCircle,
  CheckSquare,
  PlusCircle,
  Square,
  XCircle,
} from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import type { SshServerMeta } from "../contracts";
import type { PendingSshAdd, PendingSshPick } from "../useLunoState";
import { ct, ctServersSelected, ctUseServers } from "../chatStrings";
import "../sshcards.css";

/**
 * Interactive SSH cards rendered inside agent steps — the sshAdd "no server
 * configured, add one" flow and the sshPick "which server(s)?" flow. Built on
 * the same .agent-ask idiom as AskUserQuestion so they read as siblings.
 */

/** One selectable server row (shared by both cards). */
function ServerRow({
  server,
  selected,
  multi,
  onToggle,
}: {
  server: SshServerMeta;
  selected: boolean;
  multi: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      className={`agent-ask-opt ssh-pick-row${selected ? " selected" : ""}`}
      onClick={() => onToggle(server.id)}
    >
      {multi ? (
        selected ? (
          <CheckSquare size={14} weight="fill" className="ssh-pick-box on" />
        ) : (
          <Square size={14} className="ssh-pick-box" />
        )
      ) : (
        <span className="agent-ask-radio" aria-hidden="true" />
      )}
      <span className="agent-ask-opt-main">
        <span className="agent-ask-opt-label">{server.name}</span>
        <span className="ssh-pick-addr">
          {server.username}@{server.host}:{server.port}
        </span>
      </span>
    </button>
  );
}

/** Full-width "Add server" row — deep-links to the SSH settings tab. Accent
 *  styled (like the confirm button), NOT danger-red: it's a primary action. */
function AddServerRow() {
  return (
    <button
      className="ssh-btn-add"
      onClick={() => post({ type: "openSettings", tab: "ssh" })}
    >
      <PlusCircle size={14} weight="bold" />
      {ct("sshAddServer")}
    </button>
  );
}

/**
 * sshAdd — agent needs a server that isn't configured yet. The card IS a live
 * picker: "Add server" deep-links to Settings → SSH; as soon as the user adds
 * one there, the sshServers broadcast refreshes the list below and they select
 * it right here — no separate "I added it" limbo step.
 */
export function SshAddCard({
  pending,
  servers,
  onResolve,
}: {
  pending: PendingSshAdd;
  /** Live server list (refreshed by sshServers broadcasts). */
  servers: SshServerMeta[];
  onResolve: (stepId: string, added: boolean, serverId?: string) => void;
}) {
  const [selected, setSelected] = useState<string | undefined>();

  return (
    <div className="agent-ask ssh-card">
      <span className="agent-ask-header">{ct("sshNeeded")}</span>
      <p className="agent-ask-prompt">
        {pending.reason ?? ct("sshNeededDesc")}
      </p>

      <div className="agent-ask-options">
        <AddServerRow />
        {servers.map((s) => (
          <ServerRow
            key={s.id}
            server={s}
            selected={selected === s.id}
            multi={false}
            onToggle={(id) => setSelected(id)}
          />
        ))}
        {servers.length === 0 && (
          <span className="field-hint">{ct("sshNoServers")}</span>
        )}
      </div>

      <div className="agent-ask-actions ssh-actions">
        <button
          className="agent-ask-btn-secondary ssh-fixed-btn"
          onClick={() => onResolve(pending.stepId, false)}
        >
          {ct("cancel")}
        </button>
        <button
          className="agent-ask-confirm ssh-fixed-btn"
          disabled={!selected}
          onClick={() => onResolve(pending.stepId, true, selected)}
        >
          {ct("sshUseServer")}
        </button>
      </div>
      <span className="field-hint">{ct("sshCredsHint")}</span>
    </div>
  );
}

/** sshPick — choose which configured server(s) the agent should target. The
 *  first row is always the "Add server" action, so a missing server never
 *  dead-ends the flow: add it in Settings, it appears here, pick it. */
export function SshPickCard({
  pending,
  servers,
  onResolve,
}: {
  pending: PendingSshPick;
  /** Live server list (refreshed by sshServers broadcasts). */
  servers: SshServerMeta[];
  onResolve: (stepId: string, serverIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      if (pending.multi) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  }

  return (
    <div className="agent-ask ssh-card">
      <span className="agent-ask-header">
        {pending.multi ? ct("sshSelectMany") : ct("sshSelectOne")}
      </span>
      <p className="agent-ask-prompt">
        {pending.prompt ?? ct("sshWhich")}
      </p>

      <div className="agent-ask-options">
        <AddServerRow />
        {servers.map((s) => (
          <ServerRow
            key={s.id}
            server={s}
            selected={selected.has(s.id)}
            multi={pending.multi}
            onToggle={toggle}
          />
        ))}
        {servers.length === 0 && (
          <span className="field-hint">{ct("sshNoServers")}</span>
        )}
      </div>

      <div className="agent-ask-actions ssh-actions">
        <button
          className="agent-ask-btn-secondary ssh-fixed-btn"
          onClick={() => onResolve(pending.stepId, [])}
        >
          {ct("cancel")}
        </button>
        <button
          className="agent-ask-confirm ssh-fixed-btn"
          disabled={selected.size === 0}
          onClick={() => onResolve(pending.stepId, [...selected])}
          title={
            pending.multi && selected.size > 1
              ? ctUseServers(selected.size)
              : ct("sshUseServer")
          }
        >
          {pending.multi && selected.size > 1
            ? ctUseServers(selected.size)
            : ct("sshUseServer")}
        </button>
      </div>
    </div>
  );
}

/** Compact one-liner for an sshAdd/sshPick step that has already resolved. */
export function SshResolvedLine({
  kind,
  status,
  servers,
}: {
  kind: "sshAdd" | "sshPick";
  status: "done" | "error" | "rejected" | "running";
  servers?: SshServerMeta[];
}) {
  const ok = status === "done";
  let text: string;
  if (!ok) {
    text = ct("sshCancelled");
  } else if (kind === "sshAdd") {
    text = ct("sshServerSelected");
  } else {
    const n = servers?.length ?? 0;
    text = n === 1 ? ctServersSelected(1) : ctServersSelected(n);
  }
  return (
    <div className={`ssh-resolved ${ok ? "ok" : "cancelled"}`}>
      {ok ? (
        <CheckCircle size={13} weight="fill" />
      ) : (
        <XCircle size={13} weight="fill" />
      )}
      <span>{text}</span>
    </div>
  );
}
