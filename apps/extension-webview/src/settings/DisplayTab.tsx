import { Crop, SlidersHorizontal } from "@phosphor-icons/react";
import type { WebviewState } from "../contracts";
import { useT } from "./i18n";
import { SettingsCard, SliderRow, Toggle, setSetting } from "./primitives";

export function DisplayTab({ state }: { state: WebviewState }) {
  const t = useT();
  const d = state.settings.display;

  function patch(p: Partial<typeof d>) {
    setSetting("display", { ...d, ...p });
  }

  return (
    <div className="settings-pane-section animate-fade s2-display">
      <div className="pane-header">
        <h2>{t.display.title}</h2>
        <p>{t.display.desc}</p>
      </div>

      <SettingsCard icon={<Crop size={15} />} title={t.display.interface}>
        <SliderRow
          label={t.display.scale}
          hint={t.display.scaleHint}
          value={Math.round(d.uiScale * 100)}
          min={80}
          max={140}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => patch({ uiScale: v / 100 })}
        />
        <SliderRow
          label={t.display.fontScale}
          hint={t.display.fontScaleHint}
          value={Math.round(d.fontScale * 100)}
          min={80}
          max={150}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => patch({ fontScale: v / 100 })}
        />
      </SettingsCard>

      <SettingsCard
        icon={<SlidersHorizontal size={15} />}
        title={t.display.rendering}
      >
        <div className="settings-toggle-list">
          <Toggle
            label={t.display.collapseThinking}
            hint={t.display.collapseThinkingHint}
            checked={d.collapseThinking}
            onChange={(v) => patch({ collapseThinking: v })}
          />
          <Toggle
            label={t.display.collapseTools}
            hint={t.display.collapseToolsHint}
            checked={d.collapseToolOutput}
            onChange={(v) => patch({ collapseToolOutput: v })}
          />
        </div>
      </SettingsCard>
    </div>
  );
}
