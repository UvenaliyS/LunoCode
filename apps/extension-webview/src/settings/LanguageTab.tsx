import { Globe } from "@phosphor-icons/react";
import type { LunoSettings, WebviewState } from "../contracts";
import { useT, type Lang } from "./i18n";
import { SelectRow, SettingsCard, setSetting } from "./primitives";

/**
 * Language tab (kilocode-style): a single select defaulting to
 * "Auto (VS Code language)" with explicit overrides, and a "Current: …" line
 * showing what actually resolved.
 */
export function LanguageTab({
  state,
  resolved,
}: {
  state: WebviewState;
  /** The language the UI is actually rendering in (after auto-resolution). */
  resolved: Lang;
}) {
  const t = useT();
  const value = state.settings.language ?? "auto";
  const currentName = resolved === "ru" ? "Русский" : "English";

  return (
    <div className="settings-pane-section animate-fade s2-lang">
      <div className="pane-header">
        <h2>{t.language.title}</h2>
        <p>{t.language.desc}</p>
      </div>

      <SettingsCard icon={<Globe size={15} />} title={t.language.title}>
        <SelectRow
          label={t.language.label}
          hint={t.language.hint}
          value={value}
          options={[
            { value: "auto", label: t.language.auto },
            { value: "en", label: "English" },
            { value: "ru", label: "Русский" },
          ]}
          onChange={(v) =>
            setSetting("language", v as LunoSettings["language"])
          }
        />
        <span className="field-hint">
          {t.language.current} {currentName}
        </span>
      </SettingsCard>
    </div>
  );
}
