import { useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import type { ConnState, ModelInfo, Provider } from "../contracts";
import { modelBrand } from "./ModelIcon";

interface Props {
  models: ModelInfo[];
  selected?: string;
  conn: ConnState;
  onSelect: (model: string) => void;
  /** Providers, so the menu can group models by which provider serves them. */
  providers?: Provider[];
  /** Borderless trigger (no framed box) — for the composer toolbar. */
  bare?: boolean;
  /** Open the menu upward instead of downward. */
  openUp?: boolean;
}

/** Reasoning-effort levels per model — the exact sets from each provider's docs:
 *  · Claude Opus 4.8 / Sonnet: Low·Medium·High·xHigh·Max (Haiku: Low·Medium·High)
 *  · GPT-5.4 / 5.5: None·Low·Medium·High·xHigh  (no minimal, no max)
 *  · Gemini 3 Pro: Low·High only (3.1 Pro / Flash add Medium) */
function effortOptions(m: ModelInfo): string[] {
  const brand = modelBrand(m).key;
  const s = `${m.id} ${m.label}`.toLowerCase();
  if (brand === "openai") {
    return ["None", "Low", "Medium", "High", "xHigh"];
  }
  if (brand === "anthropic") {
    if (/haiku/.test(s)) return ["Low", "Medium", "High"];
    return ["Low", "Medium", "High", "xHigh", "Max"];
  }
  if (brand === "google") {
    return /3\.1|3\.5|flash/.test(s)
      ? ["Low", "Medium", "High"]
      : ["Low", "High"];
  }
  return ["Low", "Medium", "High"];
}
/** Keep a global effort valid for a given model — snap to High (or the top
 *  available) when the current level doesn't exist for that model. */
function clampEffort(m: ModelInfo, eff: string): string {
  const opts = effortOptions(m);
  if (opts.includes(eff)) return eff;
  if (opts.includes("High")) return "High";
  return opts[opts.length - 1];
}

/**
 * Model picker (mirrors the website chat dropdown). Trigger shows the current
 * model's icon + name + a reasoning-effort readout (gauge symbol + level). Each
 * selected model row carries an effort mini-dropdown on the right; effort is a
 * global setting, clamped to whatever the chosen model supports.
 */
export function ModelPicker({ models, selected, conn, onSelect, providers, bare, openUp }: Props) {
  models = models.filter((m) => !m.hidden);
  const [open, setOpen] = useState(false);
  const [effort, setEffort] = useState("High");
  const [effortOpen, setEffortOpen] = useState(false);

  const current = models.find((m) => m.id === selected) ?? models[0];
  const groups = groupByProvider(models, providers);
  const triggerCls = `model-trigger${bare ? " model-trigger-bare" : ""}`;
  const menuCls = `model-menu${openUp ? " model-menu-up" : ""}`;

  if (!current) {
    return (
      <div className="model-picker">
        <button className={triggerCls} disabled>
          <span className="model-trigger-name model-trigger-empty">
            {conn === "offline" ? "Gateway offline" : "Loading models…"}
          </span>
        </button>
      </div>
    );
  }

  const CurrentIcon = modelBrand(current).Icon;
  const curEffort = clampEffort(current, effort);

  function pickModel(m: ModelInfo) {
    onSelect(m.id);
    setEffort(clampEffort(m, effort));
    setEffortOpen(false);
    setOpen(false);
  }
  function pickEffort(opt: string) {
    setEffort(opt);
    setEffortOpen(false);
    setOpen(false); // close both
  }

  return (
    <div className="model-picker">
      <button
        className={triggerCls}
        title={`Model: ${current.label} · Effort: ${curEffort}`}
        onClick={() => setOpen((v) => !v)}
      >
        <CurrentIcon size={16} className="model-icon" />
        <span className="model-trigger-name">
          {current.label}
          <span className="model-trigger-effort">
            <span className="mte-sep">·</span>
            {curEffort}
          </span>
        </span>
        <CaretDown size={11} weight="bold" className="model-trigger-caret" />
      </button>

      {open && (
        <>
          <div
            className="model-backdrop"
            onClick={() => {
              setOpen(false);
              setEffortOpen(false);
            }}
          />
          <div className={menuCls} role="listbox">
            {groups.map((g) => (
              <div className="model-group" key={g.key}>
                <p className="model-group-label">{g.label}</p>
                {g.models.map((m) => {
                  const Icon = modelBrand(m).Icon;
                  const active = m.id === current.id;
                  return (
                    <button
                      key={m.id}
                      role="option"
                      aria-selected={active}
                      className={`model-option${active ? " active" : ""}`}
                      onClick={() => pickModel(m)}
                    >
                      <Icon size={16} className="model-icon" />
                      <span className="model-option-name">{m.label}</span>

                      {active && (
                        <span className="effort-select">
                          <span
                            className="effort-btn"
                            role="button"
                            tabIndex={0}
                            title="Reasoning effort"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEffortOpen((v) => !v);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setEffortOpen((v) => !v);
                              }
                            }}
                          >
                            {curEffort}
                            <CaretDown size={9} weight="bold" />
                          </span>

                          {effortOpen && (
                            <div className="effort-menu" role="listbox">
                              {effortOptions(m).map((opt) => (
                                <span
                                  key={opt}
                                  role="option"
                                  aria-selected={opt === curEffort}
                                  className="effort-opt"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    pickEffort(opt);
                                  }}
                                >
                                  {opt}
                                  {opt === curEffort && (
                                    <Check size={12} weight="bold" className="effort-opt-check" />
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Bucket models by the provider that serves them, in provider order (the
 *  built-in Luno provider first, then custom providers as added). Each section
 *  header names the provider, so the user sees which endpoint a model belongs
 *  to and models from different providers never blend together. */
function groupByProvider(
  models: ModelInfo[],
  providers?: Provider[],
): { key: string; label: string; models: ModelInfo[] }[] {
  const order = new Map<string, number>();
  const labelOf = new Map<string, string>();
  (providers ?? []).forEach((p, i) => {
    order.set(p.id, p.builtin ? -1 : i);
    labelOf.set(p.id, p.label);
  });

  const map = new Map<string, { key: string; label: string; models: ModelInfo[] }>();
  for (const m of models) {
    const pid = m.providerId ?? "luno";
    const g =
      map.get(pid) ??
      { key: pid, label: labelOf.get(pid) ?? (pid === "luno" ? "Luno" : pid), models: [] };
    g.models.push(m);
    map.set(pid, g);
  }
  return [...map.values()].sort(
    (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999),
  );
}
