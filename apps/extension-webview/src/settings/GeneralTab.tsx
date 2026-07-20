import { ChatDots, NotePencil } from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import type { WebviewState } from "../contracts";
import { ModelPicker } from "../components/ModelPicker";
import { useT } from "./i18n";
import { Row, SettingsCard, Toggle, setSetting } from "./primitives";

export function GeneralTab({ state }: { state: WebviewState }) {
  const t = useT();
  const s = state.settings;

  return (
    <div className="settings-pane-section animate-fade s2-gen">
      <div className="pane-header">
        <h2>{t.general.title}</h2>
        <p>{t.general.desc}</p>
      </div>

      {/* Language moved to its own Language tab (kilocode-style, auto default). */}
      <SettingsCard icon={<ChatDots size={15} />} title={t.general.chat}>
        <Row label={t.general.model} hint={t.general.modelHint}>
          {/* The chat composer's picker, verbatim: brand-grouped menu with
              model logos. Selection persists as the defaultModel setting. */}
          <ModelPicker
            models={state.models}
            selected={s.defaultModel}
            conn={state.conn}
            onSelect={(v) => setSetting("defaultModel", v)}
          />
        </Row>
        <div className="settings-toggle-list">
          <Toggle
            label={t.general.stream}
            hint={t.general.streamHint}
            checked={s.streamResponses}
            onChange={(v) => setSetting("streamResponses", v)}
          />
          <Toggle
            label={t.general.cost}
            hint={t.general.costHint}
            checked={s.showSonnetEqCost}
            onChange={(v) => setSetting("showSonnetEqCost", v)}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<NotePencil size={15} />}
        title={t.general.config}
        desc={t.general.configDesc}
      >
        <div className="group-card-row">
          <button
            className="settings-btn-primary"
            onClick={() => post({ type: "openConfigFile" })}
          >
            {t.shell.editConfig}
          </button>
          <button
            className="settings-btn-outline"
            onClick={() => post({ type: "exportConfig" })}
          >
            {t.shell.exportConfig}
          </button>
          <button
            className="settings-btn-outline"
            onClick={() => post({ type: "importConfig" })}
          >
            {t.shell.importConfig}
          </button>
        </div>
      </SettingsCard>
    </div>
  );
}
