import {
  ArrowClockwise,
  ArrowSquareOut,
  Lightning,
  Code,
  Cpu,
  TerminalWindow,
  CheckCircle,
  Warning,
  WarningCircle,
  WarningOctagon,
  type Icon,
} from "@phosphor-icons/react";
import type { UsageBucket, UsageSnapshot } from "../contracts";
import { post } from "../vscodeApi";

/** Four usage bands, low→high: green → yellow → orange → red. */
type Lvl = "ok" | "warn" | "high" | "crit";
function usageLevel(frac: number): Lvl {
  if (frac >= 0.9) return "crit";
  if (frac >= 0.75) return "high";
  if (frac >= 0.5) return "warn";
  return "ok";
}

const PLAN_ICON: Record<string, Icon> = {
  STARTER: Code,
  PLUS: Cpu,
  POWER: Lightning,
  DEV: TerminalWindow,
};
function planIcon(plan?: string): Icon {
  return PLAN_ICON[(plan ?? "").toUpperCase()] ?? Lightning;
}

const LEVEL_ICON: Record<Lvl, Icon> = {
  ok: CheckCircle,
  warn: Warning,
  high: WarningCircle,
  crit: WarningOctagon,
};

/**
 * Compact usage gauge for the composer: a coloured ring with the percentage
 * beneath it. Hovering reveals the full breakdown (plan, per-window bars,
 * actions) in a panel that unfolds upward.
 */
export function UsageRing({ usage }: { usage: UsageSnapshot }) {
  // The bucket closest to its limit drives the ring + colour band.
  const tightest = usage.buckets.reduce((worst, b) => {
    const frac = b.limit ? b.used / b.limit : 0;
    const worstFrac = worst.limit ? worst.used / worst.limit : 0;
    return frac > worstFrac ? b : worst;
  }, usage.buckets[0]);

  const usedFrac =
    tightest && tightest.limit ? Math.min(1, tightest.used / tightest.limit) : 0;
  const level = usageLevel(usedFrac);
  const pct = Math.round(usedFrac * 100);
  const PlanIcon = planIcon(usage.plan);
  const StatusIcon = LEVEL_ICON[level];

  return (
    <div className={`usage-ring-wrap lvl-${level}`}>
      <div
        className="usage-mini"
        title={`${usage.plan} · ${pct}% used`}
        aria-label={`Usage ${pct}%`}
      >
        <span className="usage-ring" style={{ ["--frac" as string]: usedFrac }} />
      </div>

      <div className="usage-popover" role="dialog">
        <div className="usage-pop-head">
          <span className="usage-pop-plan">
            <PlanIcon size={15} weight="fill" />
            {usage.plan}
          </span>
          <span className={`usage-pop-status lvl-${level}`}>
            <StatusIcon size={13} weight="fill" />
            {pct}% used
          </span>
        </div>

        <div className="usage-pop-buckets">
          {usage.buckets.map((b) => (
            <BucketBar key={b.id} bucket={b} />
          ))}
        </div>

        <div className="usage-pop-actions">
          <button className="usage-btn" onClick={() => post({ type: "buyReset" })}>
            <ArrowClockwise size={13} weight="bold" />
            Buy reset
          </button>
          <button
            className="usage-btn usage-btn-accent"
            onClick={() => post({ type: "openBilling" })}
          >
            <ArrowSquareOut size={13} weight="bold" />
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}

function BucketBar({ bucket }: { bucket: UsageBucket }) {
  const frac = bucket.limit ? Math.min(1, bucket.used / bucket.limit) : 0;
  const level = usageLevel(frac);
  return (
    <div className="bucket">
      <div className="bucket-row">
        <span className="bucket-label">{bucket.label}</span>
        <span className="bucket-val">
          {fmt(bucket.used)} / {fmt(bucket.limit)}
        </span>
      </div>
      <div className="bucket-track">
        <span
          className={`bucket-fill lvl-${level}`}
          style={{ ["--frac" as string]: frac }}
        />
      </div>
      {bucket.resetAt && (
        <span className="bucket-reset">{resetIn(bucket.resetAt)}</span>
      )}
    </div>
  );
}

/** Short "resets in" string, e.g. "resets in 3h" / "in 5d". */
function resetIn(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "resetting";
  const h = Math.round(diff / 3_600_000);
  if (h < 24) return `resets in ${Math.max(1, h)}h`;
  return `resets in ${Math.round(h / 24)}d`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(n);
}
