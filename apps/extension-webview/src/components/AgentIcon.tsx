import { useId } from "react";

interface Props {
  size?: number;
  className?: string;
  /** true (default) → head filled (eyes knocked out); false → pure outline. */
  filled?: boolean;
}

/**
 * Agent glyph — Lucide "Bot", exact paths. Two variants:
 *  · filled  (composer Agent tab + empty-chat card): head rect filled with a
 *            mask that knocks out the eyes.
 *  · outline (the Task/agent tool row): plain stroked bot.
 * Unique mask id per instance so multiple copies never clash.
 */
export function AgentIcon({ size = 16, className, filled = true }: Props) {
  const uid = useId().replace(/:/g, "");
  const maskId = `${uid}-eyes`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {filled ? (
        <>
          <defs>
            <mask id={maskId}>
              <rect width="24" height="24" fill="white" />
              <path d="M9 13v2" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M15 13v2" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
            </mask>
          </defs>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" fill="currentColor" mask={`url(#${maskId})`} />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
        </>
      ) : (
        <>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </>
      )}
    </svg>
  );
}
