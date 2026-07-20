import { Cpu, Stack } from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import type {
  ModelBrand,
  ModelInfo,
  ProviderFormat,
  WebviewState,
} from "../contracts";
import { inferModelBrand } from "../contracts";
import { ModelPicker } from "../components/ModelPicker";
import { useT } from "./i18n";
import { Row, SettingsCard, setSetting } from "./primitives";
import { brandMeta } from "./brandIcons";

const FORMATS: ProviderFormat[] = ["claude-code", "codex", "openai-v1"];
const BRAND_ORDER: ModelBrand[] = ["anthropic", "openai", "google", "xai", "other"];

export function ModelsTab({ state }: { state: WebviewState }) {
  const t = useT();
  const models = state.models;

  // Per-model wire-format overrides live on the owning provider.
  const overrides = new Map<string, ProviderFormat>();
  for (const p of state.providers ?? []) {
    for (const [modelId, fmt] of Object.entries(p.modelFormats ?? {})) {
      overrides.set(`${p.id}/${modelId}`, fmt);
    }
  }

  const groups = new Map<ModelBrand, ModelInfo[]>();
  for (const m of models) {
    const brand = m.brand ?? inferModelBrand(`${m.id} ${m.label}`);
    const list = groups.get(brand) ?? [];
    list.push(m);
    groups.set(brand, list);
  }

  return (
    <div className="settings-pane-section animate-fade s2-models">
      <div className="pane-header">
        <h2>{t.models.title}</h2>
        <p>{t.models.desc}</p>
      </div>

      <SettingsCard icon={<Cpu size={15} />} title={t.models.default}>
        <Row label={t.models.default} hint={t.general.modelHint}>
          {/* The chat composer's picker, verbatim: brand-grouped menu with
              model logos. Selection persists as the defaultModel setting. */}
          <ModelPicker
            models={models}
            selected={state.settings.defaultModel}
            conn={state.conn}
            onSelect={(v) => setSetting("defaultModel", v)}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        icon={<Stack size={15} />}
        title={t.models.library}
        desc={t.models.libraryDesc}
      >
        {models.length === 0 ? (
          <span className="field-hint-text">{t.models.empty}</span>
        ) : (
          <div className="s2-models-lib">
            {BRAND_ORDER.filter((b) => groups.has(b)).map((brand) => {
              const meta = brandMeta(brand);
              return (
                <div key={brand} className="s2-models-group">
                  <div className="s2-brand-head">
                    <meta.Icon size={14} />
                    {meta.label}
                  </div>
                  <div className="s2-models-rows">
                    {groups.get(brand)!.map((m) => (
                      <ModelRow
                        key={m.id}
                        model={m}
                        isDefault={m.id === state.settings.defaultModel}
                        override={
                          m.providerId
                            ? overrides.get(`${m.providerId}/${m.id}`)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>
    </div>
  );
}

function ModelRow({
  model,
  isDefault,
  override,
}: {
  model: ModelInfo;
  isDefault: boolean;
  override?: ProviderFormat;
}) {
  const t = useT();
  const brand = model.brand ?? inferModelBrand(`${model.id} ${model.label}`);
  const { Icon } = brandMeta(brand);

  function setFormat(v: string) {
    if (!model.providerId) return;
    post({
      type: "setModelFormat",
      providerId: model.providerId,
      modelId: model.id,
      format: v === "auto" ? undefined : (v as ProviderFormat),
    });
  }

  return (
    <div className="s2-model-row">
      <span className="s2-model-ic">
        <Icon size={16} />
      </span>
      <div className="s2-model-main">
        <span className="s2-model-name">
          <span>{model.label}</span>
        </span>
        <span className="s2-model-id">{model.id}</span>
      </div>
      {isDefault && (
        <span className="s2-model-default">{t.models.defaultBadge}</span>
      )}
      {model.providerId && (
        <select
          className="s2-model-fmt"
          title={t.models.formatOverride}
          value={override ?? "auto"}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="auto">{t.common.auto}</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
