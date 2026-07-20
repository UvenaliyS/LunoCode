import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  CircleNotch,
  Cpu,
  Desktop,
  PencilSimple,
  Plus,
  SignOut,
  Trash,
  X,
} from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import type {
  Provider,
  ProviderFormat,
  ProviderTestResult,
  WebviewState,
} from "../contracts";
import { Moon } from "@phosphor-icons/react";
import { ClaudeIcon, GeminiIcon, OpenAIIcon } from "../components/ModelIcon";
import { GrokIcon } from "./brandIcons";
import { useT } from "./i18n";
import { useHostMessage } from "./primitives";
import {
  PROVIDER_CATALOG,
  catalogFor,
  type CatalogEntry,
  type CatalogGlyph,
} from "./providerCatalog";
import "./providers.css";

const FORMATS: ProviderFormat[] = ["claude-code", "codex", "openai-v1"];

/* ── Glyphs ──────────────────────────────────────────────────────────────── */

/* Drop-in SVG logos: put `<glyph>.svg` into src/settings/provider-icons/
 * (anthropic.svg, openai.svg, google.svg, xai.svg, openrouter.svg, groq.svg,
 * mistral.svg, deepseek.svg, ollama.svg, lmstudio.svg, generic.svg) and it
 * overrides the built-in fallback automatically — no code changes needed.
 * NOTE: must stay a literal `import.meta.glob(...)` call — Vite's transform
 * is static and skips anything wrapped or aliased. */
const SVG_FILES = import.meta.glob("./provider-icons/*.svg", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const SVG_ICONS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [path, svg] of Object.entries(SVG_FILES)) {
    const name = path.split("/").pop()!.replace(/\.svg$/i, "").toLowerCase();
    map[name] = svg;
  }
  return map;
})();

function SvgGlyph({ svg, size }: { svg: string; size: number }) {
  return (
    <span
      className="prov-svg"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function Glyph({ glyph, size = 16 }: { glyph: CatalogGlyph; size?: number }) {
  const custom = SVG_ICONS[glyph];
  if (custom) return <SvgGlyph svg={custom} size={size} />;
  switch (glyph) {
    case "anthropic":
      return <ClaudeIcon size={size} />;
    case "openai":
      return <OpenAIIcon size={size} />;
    case "google":
      return <GeminiIcon size={size} />;
    case "xai":
      return <GrokIcon size={size} />;
    case "ollama":
    case "lmstudio":
      return <Desktop size={size} />;
    case "openrouter":
    case "groq":
    case "mistral":
    case "deepseek":
      return <Monogram name={glyph} />;
    default:
      return <Cpu size={size} />;
  }
}

function Monogram({ name }: { name: string }) {
  return <span className="prov-monogram">{name.slice(0, 2).toUpperCase()}</span>;
}

function providerGlyph(p: Provider): ReactNode {
  const entry = catalogFor(p.endpoint);
  if (entry) return <Glyph glyph={entry.glyph} />;
  return <Cpu size={16} />;
}

/* ── Tab ─────────────────────────────────────────────────────────────────── */

type Draft =
  | { mode: "add"; preset?: CatalogEntry }
  | { mode: "edit"; provider: Provider };

export function ProvidersTab({ state }: { state: WebviewState }) {
  const t = useT();
  // Providers arrive both inside `state` and as standalone `providers`
  // messages (after add/update/delete) — keep the freshest copy locally.
  const [providers, setProviders] = useState<Provider[]>(state.providers ?? []);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, ProviderTestResult>>({});
  const [draft, setDraft] = useState<Draft | undefined>();

  useEffect(() => {
    if (state.providers) setProviders(state.providers);
  }, [state.providers]);

  useHostMessage((msg) => {
    if (msg.type === "providers") {
      setProviders(msg.providers);
    } else if (msg.type === "providerTest") {
      setTesting((p) => ({ ...p, [msg.providerId]: false }));
      setResults((p) => ({ ...p, [msg.providerId]: msg.result }));
    }
  });

  useEffect(() => {
    post({ type: "listProviders" });
  }, []);

  function runTest(id: string) {
    setTesting((p) => ({ ...p, [id]: true }));
    post({ type: "testProvider", id });
  }

  const luno =
    providers.find((p) => p.builtin) ?? providers.find((p) => p.kind === "luno");
  const connected = providers.filter((p) => p !== luno);

  return (
    <div className="settings-pane-section animate-fade">
      <div className="pane-header">
        <h2>{t.prov.title}</h2>
        <p>{t.prov.desc}</p>
      </div>

      {/* 1 · Luno API — the built-in gateway, always on top. */}
      <div className="prov-luno">
        <div className="prov-luno-head">
          <span className="prov-luno-ic">
            <Moon size={22} weight="fill" />
          </span>
          <div className="prov-luno-text">
            <span className="prov-luno-title">{t.prov.lunoTitle}</span>
            <span className="prov-luno-line">
              {state.authed ? t.prov.lunoLine : t.prov.lunoLineOut}
            </span>
          </div>
          <span className="prov-luno-side">
            {state.authed ? (
              <span className="prov-status">
                <span className="prov-status-dot" />
                {t.prov.connectedChip}
              </span>
            ) : (
              <button className="prov-btn primary" onClick={() => post({ type: "startOAuth" })}>
                {t.prov.signIn}
              </button>
            )}
          </span>
        </div>
        {state.authed && luno && (
          <div className="prov-luno-sub">
            <span className="prov-row-endpoint">{luno.endpoint}</span>
            <TestResult result={results[luno.id] ?? luno.lastTest} />
            <TestButton
              testing={!!testing[luno.id]}
              onClick={() => runTest(luno.id)}
            />
            <button
              className="prov-icon-btn"
              title={t.account.logout}
              onClick={() => post({ type: "logout" })}
            >
              <SignOut size={14} weight="bold" />
            </button>
          </div>
        )}
      </div>

      {/* 2 · Connected custom providers */}
      <div className="prov-section">
        <h3 className="prov-section-title">{t.prov.connected}</h3>
        {connected.length === 0 ? (
          <div className="prov-empty">{t.prov.noConnected}</div>
        ) : (
          <div className="prov-list">
            {connected.map((p) => (
              <div className="prov-row" key={p.id}>
                <span className="prov-row-ic">{providerGlyph(p)}</span>
                <div className="prov-row-main">
                  <span className="prov-row-name">
                    <span>{p.label}</span>
                  </span>
                  <span className="prov-row-endpoint">{p.endpoint}</span>
                </div>
                <div className="prov-row-actions">
                  <TestResult result={results[p.id] ?? p.lastTest} />
                  <TestButton
                    testing={!!testing[p.id]}
                    onClick={() => runTest(p.id)}
                  />
                  <button
                    className="prov-icon-btn"
                    title={t.common.edit}
                    onClick={() => setDraft({ mode: "edit", provider: p })}
                  >
                    <PencilSimple size={14} />
                  </button>
                  <button
                    className="prov-icon-btn danger"
                    title={t.common.delete}
                    onClick={() => post({ type: "deleteProvider", id: p.id })}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3 · Add provider */}
      <div className="prov-section">
        <h3 className="prov-section-title">{t.prov.add}</h3>
        <div className="prov-catalog">
          {PROVIDER_CATALOG.map((entry) => (
            <button
              key={entry.id}
              className="prov-tile"
              onClick={() => setDraft({ mode: "add", preset: entry })}
            >
              <span className="prov-tile-ic">
                <Glyph glyph={entry.glyph} />
              </span>
              <span>{entry.name}</span>
            </button>
          ))}
          <button className="prov-tile" onClick={() => setDraft({ mode: "add" })}>
            <span className="prov-tile-ic">
              <Plus size={16} />
            </span>
            <span>{t.prov.custom}</span>
          </button>
        </div>
      </div>

      {draft && <ProviderDialog draft={draft} onClose={() => setDraft(undefined)} />}
    </div>
  );
}

/* ── Test result (plain text) + test button (fixed size, inline spinner) ─── */

/** Latency → severity band for the ms read-out color.
 *  ≤300 green · ≤700 yellow · ≤1000 orange · >1000 red. */
function pingBand(ms: number): string {
  if (ms <= 300) return "p-good";
  if (ms <= 700) return "p-warn";
  if (ms <= 1000) return "p-high";
  return "p-crit";
}

/** Last-test read-out as quiet inline text (no chip box). Renders nothing
 *  until there's a result — success shows a ping-colored "41 ms" plus the
 *  model count, failure the error, both right-aligned next to Test. */
function TestResult({ result }: { result?: ProviderTestResult }) {
  const t = useT();
  if (!result) return null;
  if (result.ok) {
    return (
      <span className="prov-result">
        {result.latencyMs != null && (
          <span className={`prov-ping ${pingBand(result.latencyMs)}`}>
            {result.latencyMs} ms
          </span>
        )}
        {result.modelCount != null && (
          <span className="prov-result-models">
            {result.latencyMs != null ? " · " : ""}
            {result.modelCount} {t.prov.modelsSuffix}
          </span>
        )}
        {result.latencyMs == null && result.modelCount == null && t.common.ok}
      </span>
    );
  }
  const err =
    result.error ??
    (result.status != null ? `HTTP ${result.status}` : t.common.failed);
  return (
    <span className="prov-result err" title={result.error}>
      {err}
    </span>
  );
}

/** Fixed-width Test button: while testing, the label stays put and a spinner
 *  overlays — so the width never changes and nothing around it shifts. */
function TestButton({ testing, onClick }: { testing: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      className="prov-btn prov-test-btn"
      disabled={testing}
      onClick={onClick}
    >
      <span className={testing ? "prov-test-label hidden" : "prov-test-label"}>
        {t.common.test}
      </span>
      {testing && (
        <CircleNotch size={13} weight="bold" className="prov-spin" />
      )}
    </button>
  );
}

/* ── Add / edit dialog ───────────────────────────────────────────────────── */

function ProviderDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const t = useT();
  const editing = draft.mode === "edit" ? draft.provider : undefined;
  const preset = draft.mode === "add" ? draft.preset : undefined;

  const [label, setLabel] = useState(editing?.label ?? preset?.name ?? "");
  const [endpoint, setEndpoint] = useState(editing?.endpoint ?? preset?.endpoint ?? "");
  const [format, setFormat] = useState<ProviderFormat>(
    editing?.format ?? preset?.format ?? "openai-v1",
  );
  const [autoFormat, setAutoFormat] = useState(
    editing?.autoFormat ?? preset?.autoFormat ?? true,
  );
  const [key, setKey] = useState("");

  const valid = label.trim().length > 0 && /^https?:\/\/\S+$/.test(endpoint.trim());

  function save() {
    if (!valid) return;
    const common = {
      label: label.trim(),
      endpoint: endpoint.trim(),
      format,
      autoFormat,
      key: key.trim() || undefined,
    };
    post(
      editing
        ? { type: "updateProvider", id: editing.id, ...common }
        : { type: "addProvider", ...common },
    );
    onClose();
  }

  return (
    <div className="prov-overlay" onMouseDown={onClose}>
      <div
        className="prov-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="prov-dialog-head">
          <span className="prov-dialog-title">
            {editing ? t.prov.editTitle : t.prov.addTitle}
          </span>
          <button className="prov-icon-btn" title={t.common.cancel} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="prov-field">
          <label>{t.prov.name}</label>
          <input
            className="prov-input"
            value={label}
            placeholder="OpenRouter"
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div className="prov-field">
          <label>{t.prov.endpoint}</label>
          <input
            className="prov-input"
            value={endpoint}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </div>

        <div className="prov-field">
          <label>{t.prov.format}</label>
          <div className="prov-format-row">
            <select
              className="prov-select"
              value={format}
              disabled={autoFormat}
              onChange={(e) => setFormat(e.target.value as ProviderFormat)}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`prov-auto${autoFormat ? " on" : ""}`}
              aria-pressed={autoFormat}
              onClick={() => setAutoFormat((v) => !v)}
            >
              <span className="prov-auto-box">
                {autoFormat && <Check size={11} weight="bold" />}
              </span>
              {t.prov.autoDetect}
            </button>
          </div>
        </div>

        <div className="prov-field">
          <label>{t.prov.apiKey}</label>
          <input
            className="prov-input"
            type="password"
            value={key}
            placeholder={editing?.hasKey ? t.prov.keyKept : "sk-…"}
            spellCheck={false}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        </div>

        <div className="prov-dialog-actions">
          <button className="prov-dlg-btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button
            className="prov-dlg-btn primary"
            disabled={!valid}
            onClick={save}
          >
            {editing ? t.common.save : t.prov.addTitle}
          </button>
        </div>
      </div>
    </div>
  );
}
