import { SignIn, SignOut } from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import type { UsageBucket, WebviewState } from "../contracts";
import { LunoAvatar } from "../components/LunoAvatar";
import { useT } from "./i18n";

/**
 * Account — 1:1 site styles: the Settings tab's profile card (avatar hero band
 * + email/name/plan detail grid) on top, then the Overview's metric cards and
 * Rate Limits box. Classes map Tailwind utilities from DashboardClient.tsx to
 * s2a-* rules in settings2.css.
 */

export function AccountTab({ state }: { state: WebviewState }) {
  const t = useT();
  const p = state.profile;
  const usage = state.usage;
  const planName = (p?.plan ?? state.plan ?? "free").toLowerCase();

  const bucket = (id: UsageBucket["id"]) =>
    usage?.buckets.find((b) => b.id === id);
  const fiveH = bucket("fiveHour");
  const weekly = bucket("weekly");
  const monthly = bucket("total");

  if (!state.authed) {
    return (
      <div className="settings-pane-section animate-fade">
        <div className="pane-header">
          <h2>{t.account.title}</h2>
        </div>
        <div className="s2a-signedout">
          <div className="s2a-signedout-glow" />
          <div className="s2a-signedout-tile">
            <SignIn size={28} weight="bold" />
          </div>
          <h3 className="s2a-signedout-title">{t.account.signedOutTitle}</h3>
          <p className="s2a-signedout-desc">{t.account.signedOutDesc}</p>
          <button className="s2a-btn s2a-btn-primary" onClick={() => post({ type: "startOAuth" })}>
            {t.account.connect}
          </button>
        </div>
      </div>
    );
  }

  const monthlyLimit = monthly?.limit ?? -1;

  return (
    <div className="settings-pane-section animate-fade">
      <div className="pane-header">
        <h2>{t.account.title}</h2>
      </div>

      {/* Profile — the site Settings tab's cohesive card: hero band + grid. */}
      <div className="s2a-profile-card">
        <div className="s2a-profile-hero">
          <LunoAvatar
            avatar={p?.avatar}
            seed={p?.email ?? p?.name}
            size={80}
            className="s2a-profile-avatar"
          />
          <div className="s2a-profile-id">
            <div className="s2a-profile-name-row">
              <h2 className="s2a-profile-name">
                {p?.name ?? (p?.email ?? "Luno").split("@")[0]}
              </h2>
              <span className="s2a-plan-badge">{planName}</span>
            </div>
            <p className="s2a-profile-email">{p?.email ?? "—"}</p>
          </div>
          <button
            className="s2a-logout"
            title={t.account.logout}
            aria-label={t.account.logout}
            onClick={() => post({ type: "logout" })}
          >
            <SignOut size={16} weight="bold" />
          </button>
        </div>
        <div className="s2a-profile-grid">
          <div className="s2a-profile-cell">
            <p className="s2a-microlabel">{t.account.email}</p>
            <p className="s2a-cell-value mono">{p?.email ?? "—"}</p>
          </div>
          <div className="s2a-profile-cell">
            <p className="s2a-microlabel">{t.account.planLabel}</p>
            <p className="s2a-cell-value plan">{planName}</p>
          </div>
          <div className="s2a-profile-cell">
            <p className="s2a-microlabel">{t.account.planExpires}</p>
            <p className="s2a-cell-value">
              {planName === "free"
                ? t.account.planPerpetual
                : p?.planExpiresAt
                  ? new Date(p.planExpiresAt).toLocaleDateString()
                  : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Metrics — the overview's auto-fit card grid, our three cards. */}
      <div className="s2a-metrics">
        <MetricCard
          label={t.account.tokensUsed}
          value={formatTokensFull(monthly?.used ?? 0)}
          limit={
            monthlyLimit === -1
              ? undefined
              : `${t.account.limitOf} ${formatTokens(monthlyLimit)}`
          }
        />
        <MetricCard
          label={t.account.bonusBalance}
          value={usage?.bonusBalance != null ? `$${usage.bonusBalance.toFixed(2)}` : "—"}
        />
        <MetricCard
          label={t.account.requestsToday}
          value={usage?.requestsToday != null ? String(usage.requestsToday) : "—"}
        />
      </div>

      {/* Rate Limits — the overview box, bars ported exactly. */}
      <div className="s2a-box s2a-limits">
        <p className="s2a-box-title">{t.account.rateLimits}</p>
        {usage ? (
          <>
            <LimitBar
              label={t.account.hourlyLimit}
              used={fiveH?.used ?? 0}
              limit={fiveH?.limit ?? -1}
              variant="percent"
            />
            <LimitBar
              label={t.account.weeklyLimit}
              used={weekly?.used ?? 0}
              limit={weekly?.limit ?? -1}
              variant="percent"
            />
            <LimitBar
              label={t.account.monthlyLimit}
              used={monthly?.used ?? 0}
              limit={monthlyLimit}
              variant="tokens"
            />
            {usage.requestsMonth != null && (
              <p className="s2a-total-requests">
                {t.account.totalRequests}:{" "}
                <span>{usage.requestsMonth.toLocaleString("en-US")}</span>
              </p>
            )}
          </>
        ) : (
          <span className="field-hint">{t.account.noUsage}</span>
        )}
      </div>
    </div>
  );
}

/** The site's MetricCard, ported: hk-box p-4, 9px bold uppercase label,
 *  container-query-fluid black number with a muted "of <limit>" suffix. */
function MetricCard({
  label,
  value,
  limit,
}: {
  label: string;
  value: string;
  limit?: string;
}) {
  return (
    <div className="s2a-metric">
      <p className="s2a-metric-label">{label}</p>
      <p className="s2a-metric-value">
        <span className="s2a-metric-num">{value}</span>
        {limit && <span className="s2a-metric-limit"> {limit}</span>}
      </p>
    </div>
  );
}

/**
 * The site's ProgressBar/ProgressBarPercent, ported exactly: uppercase dim
 * label, bold white value, 14px sharp track, red-600 fill that shifts to
 * yellow-500 past 70% and red-500 past 90%, 1% minimum so the bar never
 * disappears. -1 limit = unlimited (∞, decorative 2% fill).
 */
function LimitBar({
  label,
  used,
  limit,
  variant,
}: {
  label: string;
  used: number;
  limit: number;
  variant: "percent" | "tokens";
}) {
  if (limit === -1) {
    return (
      <div className="s2a-limit">
        <div className="s2a-limit-head">
          <span className="s2a-limit-label">{label}</span>
          <span className="s2a-limit-value">
            {variant === "tokens" ? `${formatTokensFull(used)} / ∞` : "∞"}
          </span>
        </div>
        <div className="s2a-track">
          <div className="s2a-fill" style={{ transform: "scaleX(0.02)" }} />
        </div>
      </div>
    );
  }
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const level = pct > 90 ? "crit" : pct > 70 ? "warn" : "";
  return (
    <div className="s2a-limit">
      <div className="s2a-limit-head">
        <span className="s2a-limit-label">{label}</span>
        <span className="s2a-limit-value">
          {variant === "percent"
            ? `${pct.toFixed(0)}%`
            : `${formatTokensFull(used)} / ${formatTokens(limit)}`}
        </span>
      </div>
      <div className="s2a-track">
        <div
          className={`s2a-fill${level ? ` ${level}` : ""}`}
          style={{ transform: `scaleX(${Math.max(pct, 1) / 100})` }}
        />
      </div>
    </div>
  );
}

/** The site's formatTokens: 21.0B → 21B, 1.5M stays 1.5M, K rounds whole. */
function formatTokens(n: number): string {
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, "");
  if (n >= 1_000_000_000) return `${trim(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatTokensFull(n: number): string {
  return n.toLocaleString("en-US");
}
