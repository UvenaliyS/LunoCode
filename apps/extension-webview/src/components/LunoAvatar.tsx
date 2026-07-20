import {
  Moon,
  Crown,
  Lightning,
  Rocket,
  Star,
  Sparkle,
  Fire,
  Heart,
  Planet,
  Lightbulb,
  GameController,
  MusicNotes,
  Cube,
  Hexagon,
  Leaf,
  type Icon,
} from "@phosphor-icons/react";

/**
 * 1:1 port of the site's generated avatar (LUNO_WEBSITE LunoAvatar +
 * avatarPalette): a pastel square with a phosphor glyph in the pair's accent
 * color. The whole look is reproduced from the `luno:<palette>:<icon>` token
 * the cabinet stores, so the extension shows exactly the same avatar.
 */

const AVATAR_PALETTE_SIZE = 50;

/** Same glyph order as the site — the icon index is persisted. */
const AVATAR_ICONS: Icon[] = [
  Moon,
  Crown,
  Lightning,
  Rocket,
  Star,
  Sparkle,
  Fire,
  Heart,
  Planet,
  Lightbulb,
  GameController,
  MusicNotes,
  Cube,
  Hexagon,
  Leaf,
];

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** The site's 50 pastel↔accent pairs (golden-angle hue wheel). */
const AVATAR_PAIRS = Array.from({ length: AVATAR_PALETTE_SIZE }, (_, i) => {
  const hue = (i * 137.508) % 360;
  const bgSat = 58 + ((i * 7) % 14);
  const bgLight = 92 + ((i * 2) % 4);
  const accSat = 78 + ((i * 5) % 14);
  const accLight = 44 + ((i * 3) % 8);
  return {
    bg: hslToHex(hue, bgSat, bgLight),
    accent: hslToHex(hue, accSat, accLight),
  };
});

const PREFIX = "luno:";

function decodePalette(avatar?: string | null): number | null {
  if (!avatar || !avatar.startsWith(PREFIX)) return null;
  const n = parseInt(avatar.slice(PREFIX.length).split(":")[0], 10);
  if (!Number.isFinite(n)) return null;
  return ((Math.floor(n) % AVATAR_PALETTE_SIZE) + AVATAR_PALETTE_SIZE) % AVATAR_PALETTE_SIZE;
}

function decodeIcon(avatar?: string | null): number {
  if (!avatar || !avatar.startsWith(PREFIX)) return 0;
  const parts = avatar.slice(PREFIX.length).split(":");
  const n = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (!Number.isFinite(n)) return 0;
  return ((Math.floor(n) % AVATAR_ICONS.length) + AVATAR_ICONS.length) % AVATAR_ICONS.length;
}

/** Deterministic palette index from a string seed (stable per user). */
function seedIndex(seed?: string | null): number {
  if (!seed) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function LunoAvatar({
  avatar,
  seed,
  size = 32,
  className = "",
}: {
  avatar?: string | null;
  seed?: string | null;
  size?: number;
  className?: string;
}) {
  const stored = decodePalette(avatar);
  const idx = stored != null ? stored : seedIndex(seed);
  const { bg, accent } = AVATAR_PAIRS[idx % AVATAR_PALETTE_SIZE];
  const iconIdx =
    stored != null ? decodeIcon(avatar) : seedIndex(seed) % AVATAR_ICONS.length;
  const Glyph = AVATAR_ICONS[iconIdx] ?? AVATAR_ICONS[0];

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        // The site rounds the avatar 28% — the one place rounding is brand.
        borderRadius: "28%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        background: bg,
      }}
      aria-hidden
    >
      <Glyph weight="fill" size={Math.round(size * 0.56)} color={accent} />
    </div>
  );
}
