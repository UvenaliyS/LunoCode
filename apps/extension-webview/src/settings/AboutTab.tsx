import { useState } from "react";
import { ArrowsCounterClockwise, Info, LinkSimple } from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import { useT } from "./i18n";
import { SettingsCard } from "./primitives";
import type { WebviewState } from "../contracts";

export function AboutTab({ state }: { state: WebviewState }) {
  const t = useT();
  const [reloading, setReloading] = useState(false);

  function reload() {
    setReloading(true);
    post({ type: "reload" });
    setTimeout(() => setReloading(false), 900);
  }

  return (
    <div className="settings-pane-section animate-fade s2-about">
      <div className="pane-header">
        <h2>{t.about.title}</h2>
        <p>{t.about.desc}</p>
      </div>

      <SettingsCard icon={<Info size={15} />} title="Luno Code">
        <div className="s2-kv">
          <span className="s2-kv-key">{t.about.version}</span>
          <span className="s2-kv-val">{state.extensionVersion ?? "—"}</span>
        </div>
        <div className="s2-kv">
          <span className="s2-kv-key">{t.about.license}</span>
          <span className="s2-kv-val">MIT</span>
        </div>
        <div className="group-card-row">
          <button
            className={`settings-action-btn ${reloading ? "active" : ""}`}
            title={t.about.reloadHint}
            onClick={reload}
          >
            <ArrowsCounterClockwise size={13} className={reloading ? "s2-spin" : ""} />
            <span>{t.about.reload}</span>
          </button>
        </div>
      </SettingsCard>

      <SettingsCard icon={<LinkSimple size={15} />} title={t.about.links}>
        <div className="s2-kv">
          <span className="s2-kv-key">{t.about.website}</span>
          <a href="https://luno.codes" target="_blank" rel="noreferrer">
            luno.codes
          </a>
        </div>
        <div className="s2-kv">
          <span className="s2-kv-key">{t.about.repo}</span>
          <a
            href="https://github.com/UvenaliyS/LunoCode"
            target="_blank"
            rel="noreferrer"
          >
            github.com/UvenaliyS/LunoCode
          </a>
        </div>
      </SettingsCard>

      <div className="settings-footer-banner">
        <p>Luno Code — Open-source AI Coding for VS Code</p>
        <span>MIT</span>
      </div>
    </div>
  );
}
