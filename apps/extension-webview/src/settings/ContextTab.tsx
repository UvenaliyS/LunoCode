import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowsInLineHorizontal, FileText, Note } from "@phosphor-icons/react";
import type { WebviewState } from "../contracts";
import { useT } from "./i18n";
import { SettingsCard, SliderRow, Toggle, setSetting } from "./primitives";

export function ContextTab({ state }: { state: WebviewState }) {
  const t = useT();
  const c = state.settings.context;

  function patch(p: Partial<typeof c>) {
    setSetting("context", { ...c, ...p });
  }

  return (
    <div className="settings-pane-section animate-fade s2-context">
      <div className="pane-header">
        <h2>{t.context.title}</h2>
        <p>{t.context.desc}</p>
      </div>

      <SettingsCard
        icon={<ArrowsInLineHorizontal size={15} />}
        title={t.context.compaction}
      >
        <div className="settings-toggle-list">
          <Toggle
            label={t.context.autoCompact}
            hint={t.context.autoCompactHint}
            checked={c.autoCompact}
            onChange={(v) => patch({ autoCompact: v })}
          />
        </div>
        <SliderRow
          label={t.context.threshold}
          hint={t.context.thresholdHint}
          value={c.compactThresholdPct}
          min={20}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => patch({ compactThresholdPct: v })}
        />
        <div className="settings-toggle-list">
          <Toggle
            label={t.context.prune}
            hint={t.context.pruneHint}
            checked={c.pruneOldOutputs}
            onChange={(v) => patch({ pruneOldOutputs: v })}
          />
        </div>
      </SettingsCard>

      <SettingsCard icon={<FileText size={15} />} title={t.context.files}>
        <SliderRow
          label={t.context.maxFileSize}
          hint={t.context.maxFileSizeHint}
          value={c.maxFileSizeKb}
          min={4}
          max={200}
          step={4}
          format={(v) => `${v} KB`}
          onChange={(v) => patch({ maxFileSizeKb: v })}
        />
      </SettingsCard>

      <SettingsCard
        icon={<Note size={15} />}
        title={t.context.rules}
        desc={t.context.rulesDesc}
      >
        <RulesEditor
          value={c.customInstructions}
          placeholder={t.context.rulesPlaceholder}
          onCommit={(v) => patch({ customInstructions: v })}
        />
      </SettingsCard>
    </div>
  );
}

/** Multi-line instructions, committed on blur so we don't post every keystroke.
 *  Auto-grows with content up to a max height, then scrolls — so opening the tab
 *  already shows the text at its natural height, not a tiny collapsed box. */
function RulesEditor({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);

  // Resize to fit content up to the CSS max-height (then the box scrolls).
  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  // useLayoutEffect so the height is right on first paint (tab open) — no flash
  // of a collapsed box before it expands.
  useLayoutEffect(autosize, [draft]);

  return (
    <textarea
      ref={ref}
      className="s2-textarea"
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft.trim();
        if (v !== value) onCommit(v);
      }}
    />
  );
}
