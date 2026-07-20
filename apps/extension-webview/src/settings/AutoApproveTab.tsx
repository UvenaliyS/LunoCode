import { useState } from "react";
import {
  ArrowRight,
  FileText,
  ListChecks,
  Plus,
  ShieldCheck,
  TerminalWindow,
  Trash,
} from "@phosphor-icons/react";
import type { SettingsTabId, WebviewState } from "../contracts";
import { useT } from "./i18n";
import { SettingsCard, SliderRow, Toggle, setSetting } from "./primitives";

export function AutoApproveTab({
  state,
  onGoTab,
}: {
  state: WebviewState;
  onGoTab: (id: SettingsTabId) => void;
}) {
  const t = useT();
  const a = state.settings.autoApprove;
  // When approvals are fully automatic (Agent tab), these knobs don't apply —
  // everything is approved regardless. Show a note and disable the controls.
  const autoMode = state.settings.approvalMode === "auto";

  function patch(p: Partial<typeof a>) {
    setSetting("autoApprove", { ...a, ...p });
  }

  return (
    <div className="settings-pane-section animate-fade s2-autoapprove">
      <div className="pane-header">
        <h2>{t.autoApprove.title}</h2>
        <p>{t.autoApprove.desc}</p>
      </div>

      {autoMode && (
        <div className="s2aa-note">
          <ShieldCheck size={14} weight="fill" />
          <span>{t.autoApprove.autoNote}</span>
          <button className="s2aa-note-link" onClick={() => onGoTab("agent")}>
            {t.autoApprove.goAgent}
            <ArrowRight size={12} weight="bold" />
          </button>
        </div>
      )}

      <SettingsCard icon={<FileText size={15} />} title={t.autoApprove.tools}>
        <div className="settings-toggle-list">
          <Toggle
            label={t.autoApprove.readFiles}
            hint={t.autoApprove.readFilesHint}
            checked={a.readFiles}
            disabled={autoMode}
            onChange={(v) => patch({ readFiles: v })}
          />
          <Toggle
            label={t.autoApprove.writeFiles}
            hint={t.autoApprove.writeFilesHint}
            checked={a.writeFiles}
            disabled={autoMode}
            onChange={(v) => patch({ writeFiles: v })}
          />
          <Toggle
            label={t.autoApprove.applyEdits}
            hint={t.autoApprove.applyEditsHint}
            checked={a.applyEdits}
            disabled={autoMode}
            onChange={(v) => patch({ applyEdits: v })}
          />
          <Toggle
            label={t.autoApprove.runCommands}
            hint={t.autoApprove.runCommandsHint}
            checked={a.runCommands}
            disabled={autoMode}
            onChange={(v) => patch({ runCommands: v })}
          />
          <Toggle
            label={t.autoApprove.sshCommands}
            hint={t.autoApprove.sshCommandsHint}
            checked={a.sshCommands}
            disabled={autoMode}
            onChange={(v) => patch({ sshCommands: v })}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<TerminalWindow size={15} />}
        title={t.autoApprove.allowlist}
        desc={t.autoApprove.allowlistDesc}
      >
        <AllowList
          items={a.allowedCommands}
          disabled={autoMode || a.runCommands}
          placeholder={t.autoApprove.allowlistPlaceholder}
          addLabel={t.autoApprove.add}
          emptyLabel={t.autoApprove.empty}
          onChange={(list) => patch({ allowedCommands: list })}
        />
      </SettingsCard>

      <SettingsCard icon={<ListChecks size={15} />} title={t.autoApprove.limit}>
        <SliderRow
          label={t.autoApprove.limit}
          hint={t.autoApprove.limitHint}
          value={a.maxAutoApprovals}
          min={0}
          max={50}
          step={1}
          format={(v) => (v === 0 ? t.autoApprove.unlimited : String(v))}
          onChange={(v) => patch({ maxAutoApprovals: v })}
        />
      </SettingsCard>
    </div>
  );
}

/** Editable list of trusted command prefixes. */
function AllowList({
  items,
  disabled,
  placeholder,
  addLabel,
  emptyLabel,
  onChange,
}: {
  items: string[];
  disabled: boolean;
  placeholder: string;
  addLabel: string;
  emptyLabel: string;
  onChange: (list: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  }

  return (
    <div className={`s2aa-allow${disabled ? " s2-disabled" : ""}`}>
      <div className="s2aa-allow-add">
        <input
          className="s2-input"
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button
          className="s2aa-allow-btn"
          disabled={disabled || !draft.trim()}
          onClick={add}
        >
          <Plus size={13} weight="bold" />
          {addLabel}
        </button>
      </div>
      {items.length === 0 ? (
        <span className="field-hint-text">{emptyLabel}</span>
      ) : (
        <div className="s2aa-chips">
          {items.map((cmd) => (
            <span className="s2aa-chip" key={cmd}>
              <code>{cmd}</code>
              <button
                className="s2aa-chip-x"
                disabled={disabled}
                aria-label="Remove"
                onClick={() => onChange(items.filter((c) => c !== cmd))}
              >
                <Trash size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
