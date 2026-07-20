import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowsCounterClockwise,
  CheckCircle,
  DownloadSimple,
  NotePencil,
  UploadSimple,
  XCircle,
} from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import type {
  ExtensionToWebview,
  LunoSettings,
  SettingsTabId,
} from "../contracts";
import { useT } from "./i18n";

/* ───────────────────────────────────────────────────────────────────────────
   Shared primitives for the Settings screen. Everything here binds straight
   to host state — controls apply instantly (no save bar).
   ─────────────────────────────────────────────────────────────────────────── */

/** Persist one settings key host-side; state flows back via `state` messages. */
export function setSetting<K extends keyof LunoSettings>(
  key: K,
  value: LunoSettings[K],
): void {
  post({ type: "updateSetting", key, value });
}

/** Subscribe to raw host→webview window messages (the ones useLunoState may
 *  not surface: providerTest, sshTestResult, configTransfer, sshServers,
 *  navigate…). Handler is kept fresh via a ref so callers can close over
 *  state without re-subscribing. */
export function useHostMessage(handler: (msg: ExtensionToWebview) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionToWebview>) {
      const msg = event.data;
      if (!msg || typeof msg.type !== "string") return;
      ref.current(msg);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
}

/* ── Shell ────────────────────────────────────────────────────────────────── */

/**
 * Top bar (back · title · EN/RU · Edit Config / Export / Import / Reload)
 * around the split rail+pane layout. Shows a transient toast for
 * `configTransfer` results.
 */
export function SettingsShell({ children }: { children: ReactNode }) {
  const t = useT();
  const [reloading, setReloading] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | undefined>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useHostMessage((msg) => {
    if (msg.type !== "configTransfer") return;
    const base =
      msg.op === "export"
        ? msg.ok
          ? t.shell.exportOk
          : t.shell.exportErr
        : msg.ok
          ? t.shell.importOk
          : t.shell.importErr;
    setToast({
      kind: msg.ok ? "ok" : "err",
      text: msg.detail ? `${base} — ${msg.detail}` : base,
    });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 4000);
  });
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function reload() {
    setReloading(true);
    post({ type: "reload" });
    setTimeout(() => setReloading(false), 900);
  }

  return (
    <div className="settings-app s2-app">
      <div className="settings-top-bar">
        <div className="settings-header-left s2-header-left">
          <span className="settings-top-title-text">{t.shell.title}</span>
        </div>

        <div className="settings-header-actions-wrapper">
          <div className="settings-header-actions">
            <button
              className="settings-action-btn"
              title={t.shell.editConfig}
              onClick={() => post({ type: "openConfigFile" })}
            >
              <NotePencil size={13} />
              <span>{t.shell.editConfig}</span>
            </button>
            <button
              className="settings-action-btn"
              title={t.shell.exportConfig}
              onClick={() => post({ type: "exportConfig" })}
            >
              <UploadSimple size={13} />
              <span>{t.shell.exportConfig}</span>
            </button>
            <button
              className="settings-action-btn"
              title={t.shell.importConfig}
              onClick={() => post({ type: "importConfig" })}
            >
              <DownloadSimple size={13} />
              <span>{t.shell.importConfig}</span>
            </button>
            <button
              className={`settings-action-btn ${reloading ? "active" : ""}`}
              title={t.shell.reload}
              onClick={reload}
            >
              <ArrowsCounterClockwise size={13} className={reloading ? "s2-spin" : ""} />
              <span>{t.shell.reload}</span>
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`s2-toast ${toast.kind}`} onClick={() => setToast(undefined)}>
          {toast.kind === "ok" ? (
            <CheckCircle size={13} weight="fill" />
          ) : (
            <XCircle size={13} weight="fill" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      <div className="settings-split-container">{children}</div>
    </div>
  );
}

/* ── Tab rail ─────────────────────────────────────────────────────────────── */

/** Anything icon-shaped: phosphor icons and our custom glyphs (AgentIcon,
 *  LunoMoonIcon) all satisfy this. A plain call signature (not ComponentType)
 *  so phosphor's ForwardRef components assign without propTypes clashes.
 *  `weight: "fill"` marks the active tab. */
export type RailIcon = (props: {
  size?: number;
  weight?: "fill" | "regular";
  className?: string;
}) => ReactNode;

export interface RailItem {
  id: SettingsTabId;
  label: string;
  Icon: RailIcon;
  /** Show the small green indicator dot (e.g. Luno App linked). */
  dot?: boolean;
}

/** Left vertical tab rail. Collapses to icons-only under 520px container
 *  width (see settings2.css). */
export function TabRail({
  items,
  active,
  onSelect,
}: {
  items: RailItem[];
  active: SettingsTabId;
  onSelect: (id: SettingsTabId) => void;
}) {
  return (
    <nav className="s2-rail" role="tablist" aria-orientation="vertical">
      {items.map(({ id, label, Icon, dot }) => (
        <button
          key={id}
          role="tab"
          aria-selected={active === id}
          title={label}
          className={`settings-tab-btn ${active === id ? "active" : ""}`}
          onClick={() => onSelect(id)}
        >
          {/* Site sidebar contract, but with our larger 20px glyphs and no
              fill on the active tab — the background highlight is enough. */}
          <Icon size={20} weight="regular" />
          <span>{label}</span>
          {dot && <span className="tab-indicator" />}
        </button>
      ))}
    </nav>
  );
}

/* ── Cards & rows ─────────────────────────────────────────────────────────── */

export function SettingsCard({
  icon,
  title,
  badge,
  desc,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  /** Optional right-aligned header slot (StatusBadge, chip, action…). */
  badge?: ReactNode;
  desc?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-group-card${className ? ` ${className}` : ""}`}>
      <div className="card-header">
        <span className="card-header-ic s2-card-ic">{icon}</span>
        <h4>{title}</h4>
        {badge && <span className="s2-card-badge">{badge}</span>}
      </div>
      {desc && <p className="group-card-desc">{desc}</p>}
      {children}
    </div>
  );
}

/** Generic label+hint on the left, arbitrary control on the right. */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="s2-row">
      <div className="settings-toggle-info">
        <span className="toggle-label-text">{label}</span>
        {hint && <span className="toggle-hint-text">{hint}</span>}
      </div>
      {children && <div className="s2-row-control">{children}</div>}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`settings-toggle-row${disabled ? " s2-disabled" : ""}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <div className="settings-toggle-info">
        <span className="toggle-label-text">{label}</span>
        {hint && <span className="toggle-hint-text">{hint}</span>}
      </div>
      <button
        type="button"
        className={`settings-switch-btn ${checked ? "active" : ""}`}
        aria-pressed={checked}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
      >
        <span className="settings-switch-knob" />
      </button>
    </div>
  );
}

export function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <select
        className="settings-select s2-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** Text input that commits on blur / Enter so we don't post every keystroke. */
export function TextRow({
  label,
  hint,
  value,
  placeholder,
  type = "text",
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  type?: "text" | "password" | "url";
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Re-sync when host state changes underneath (another window, import…).
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const v = draft.trim();
    if (v !== value) onCommit(v);
  }

  return (
    <Row label={label} hint={hint}>
      <input
        className="s2-input"
        type={type}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </Row>
  );
}

export function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  // Fill percentage drives the red-to-zinc track split (site calculator look).
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="settings-field">
      <div className="slider-row">
        <label>{label}</label>
        <span className="slider-value">{format ? format(value) : value}</span>
      </div>
      {hint && <span className="field-hint-text">{hint}</span>}
      <input
        type="range"
        className="settings-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/* ── Status badge ─────────────────────────────────────────────────────────── */

export type BadgeKind = "ok" | "err" | "warn" | "muted";

export function StatusBadge({
  kind,
  children,
  pulse,
}: {
  kind: BadgeKind;
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span className={`s2-badge ${kind}`}>
      <span className={`s2-badge-dot${pulse ? " pulse" : ""}`} />
      {children}
    </span>
  );
}
