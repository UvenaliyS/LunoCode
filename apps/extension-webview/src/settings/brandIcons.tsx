import type { ComponentType } from "react";
import {
  ClaudeIcon,
  GeminiIcon,
  GenericModelIcon,
  OpenAIIcon,
} from "../components/ModelIcon";
import type { ModelBrand } from "../contracts";

interface IconProps {
  size?: number;
  className?: string;
}

/** xAI / Grok glyph — local to the settings screen (ModelIcon.tsx is owned by
 *  another agent, so the new brand icon lives here instead). */
export function GrokIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#e4e4e7"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M6.469 8.776 16.512 23h-4.464L2.005 8.776H6.47Zm-.004 7.9 2.233 3.164L6.467 23H2l4.465-6.324ZM22 2.582V23h-3.659V7.764L22 2.582ZM22 1l-9.952 14.095-2.233-3.163L17.533 1H22Z" />
    </svg>
  );
}

export interface BrandMeta {
  key: ModelBrand;
  label: string;
  Icon: ComponentType<IconProps>;
  order: number;
}

const BRANDS: Record<ModelBrand, BrandMeta> = {
  anthropic: { key: "anthropic", label: "Anthropic", Icon: ClaudeIcon, order: 0 },
  openai: { key: "openai", label: "OpenAI", Icon: OpenAIIcon, order: 1 },
  google: { key: "google", label: "Google", Icon: GeminiIcon, order: 2 },
  xai: { key: "xai", label: "xAI", Icon: GrokIcon, order: 3 },
  other: { key: "other", label: "Other", Icon: GenericModelIcon, order: 4 },
};

export function brandMeta(brand: ModelBrand): BrandMeta {
  return BRANDS[brand] ?? BRANDS.other;
}
