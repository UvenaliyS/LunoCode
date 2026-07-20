import { useId } from "react";

interface Props {
  size?: number;
  /** phosphor-compatible: "fill" renders the active (inverted) variant. */
  weight?: string;
  className?: string;
}

/**
 * The Luno logo as an icon — the moon inside a square frame, with the exact
 * paths and proportions of media/luno-moon.svg (256 viewBox, moon scaled 0.72
 * and centered). Two variants:
 *   · regular — the logo as-is: square outline + filled moon;
 *   · fill    — inverted: solid square with the moon knocked out (mask), for
 *               the active tab state.
 */
export function LunoMoonIcon({ size = 15, weight = "regular", className }: Props) {
  const uid = useId().replace(/:/g, "");
  const maskId = `${uid}-moon`;
  const moon =
    "M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z";
  const moonTransform =
    "translate(128 128) scale(0.72) translate(-133.97 -122.08)";

  if (weight === "fill") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 256 256"
        className={className}
        aria-hidden="true"
      >
        <defs>
          <mask id={maskId}>
            <rect width="256" height="256" fill="white" />
            <path d={moon} transform={moonTransform} fill="black" />
          </mask>
        </defs>
        <rect
          x="8"
          y="8"
          width="240"
          height="240"
          fill="currentColor"
          mask={`url(#${maskId})`}
        />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 8 H248 V248 H8 Z M24 24 V232 H232 V24 Z"
      />
      <path fill="currentColor" d={moon} transform={moonTransform} />
    </svg>
  );
}
