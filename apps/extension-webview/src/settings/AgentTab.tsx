import { HardDrives, ShieldCheck } from "@phosphor-icons/react";
import type { SettingsTabId, WebviewState } from "../contracts";
import { useT } from "./i18n";
import { SettingsCard, Toggle, setSetting } from "./primitives";

export function AgentTab({
  state,
  onGoTab,
}: {
  state: WebviewState;
  onGoTab: (id: SettingsTabId) => void;
}) {
  const t = useT();
  const s = state.settings;

  return (
    <div className="settings-pane-section animate-fade s2-agent">
      <div className="pane-header">
        <h2>{t.agent.title}</h2>
        <p>{t.agent.desc}</p>
      </div>

      <SettingsCard
        icon={<ShieldCheck size={15} />}
        title={t.agent.approvals}
        desc={t.agent.approvalsDesc}
      >
        <div className="mode-choose settings-agent-modes">
          <button
            className={`mode-card ${s.approvalMode === "ask" ? "active mode-card-chat" : ""}`}
            onClick={() => setSetting("approvalMode", "ask")}
          >
            <span className="mode-card-title">{t.agent.ask}</span>
            <span className="mode-card-sub">{t.agent.askSub}</span>
          </button>
          <button
            className={`mode-card ${s.approvalMode === "auto" ? "active mode-card-agent" : ""}`}
            onClick={() => setSetting("approvalMode", "auto")}
          >
            <span className="mode-card-title">{t.agent.auto}</span>
            <span className="mode-card-sub">{t.agent.autoSub}</span>
          </button>
        </div>
      </SettingsCard>

      <SettingsCard icon={<HardDrives size={15} />} title={t.agent.sshTools}>
        <div className="settings-toggle-list">
          <Toggle
            label={t.agent.sshTools}
            hint={t.agent.sshToolsHint}
            checked={s.sshEnabled}
            onChange={(v) => setSetting("sshEnabled", v)}
          />
        </div>
        <div className="group-card-row">
          <button className="settings-btn-outline" onClick={() => onGoTab("ssh")}>
            {t.agent.sshManage}
            {state.sshServers?.length ? ` (${state.sshServers.length})` : ""}
          </button>
        </div>
      </SettingsCard>
    </div>
  );
}
