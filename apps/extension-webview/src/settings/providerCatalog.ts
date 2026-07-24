import type { ProviderFormat } from "../contracts";

/**
 * Static catalog of well-known endpoints for the Providers tab. Pure data —
 * glyphs are resolved to components in ProvidersTab so this stays a .ts file.
 */
export type CatalogGlyph =
  | "anthropic"
  | "openai"
  | "google"
  | "azure"
  | "xai"
  | "openrouter"
  | "groq"
  | "mistral"
  | "deepseek"
  | "ollama"
  | "lmstudio"
  | "generic";

export interface CatalogEntry {
  id: string;
  name: string;
  endpoint: string;
  format: ProviderFormat;
  /** Whether the add dialog starts with per-model format probing on. */
  autoFormat: boolean;
  glyph: CatalogGlyph;
  /** Hostnames that identify this provider (subdomains match too). */
  hosts: string[];
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    endpoint: "https://api.anthropic.com",
    format: "claude-code",
    autoFormat: false,
    glyph: "anthropic",
    hosts: ["anthropic.com"],
  },
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    format: "codex",
    autoFormat: true,
    glyph: "openai",
    hosts: ["openai.com"],
  },
  {
    id: "google",
    name: "Google",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    format: "openai-v1",
    autoFormat: false,
    glyph: "google",
    hosts: ["googleapis.com"],
  },
  {
    id: "azure",
    name: "Azure AI",
    endpoint: "https://YOUR-RESOURCE.openai.azure.com/openai/v1",
    format: "openai-v1",
    autoFormat: true,
    glyph: "azure",
    hosts: [
      "openai.azure.com",
      "services.ai.azure.com",
      "models.ai.azure.com",
    ],
  },
  {
    id: "xai",
    name: "xAI",
    endpoint: "https://api.x.ai/v1",
    format: "openai-v1",
    autoFormat: false,
    glyph: "xai",
    hosts: ["x.ai"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    format: "openai-v1",
    autoFormat: false,
    glyph: "openrouter",
    hosts: ["openrouter.ai"],
  },
  {
    id: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    format: "openai-v1",
    autoFormat: false,
    glyph: "groq",
    hosts: ["groq.com"],
  },
  {
    id: "mistral",
    name: "Mistral",
    endpoint: "https://api.mistral.ai/v1",
    format: "openai-v1",
    autoFormat: false,
    glyph: "mistral",
    hosts: ["mistral.ai"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    format: "openai-v1",
    autoFormat: false,
    glyph: "deepseek",
    hosts: ["deepseek.com"],
  },
  {
    id: "ollama",
    name: "Ollama",
    endpoint: "http://localhost:11434/v1",
    format: "openai-v1",
    autoFormat: true,
    glyph: "ollama",
    hosts: [],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    endpoint: "http://localhost:1234/v1",
    format: "openai-v1",
    autoFormat: true,
    glyph: "lmstudio",
    hosts: [],
  },
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function portOf(u: URL): string {
  return u.port || (u.protocol === "https:" ? "443" : "80");
}

/** Match a saved provider endpoint to a catalog entry (drives the row glyph).
 *  Cloud entries match by hostname; local ones by port. */
export function catalogFor(endpoint: string): CatalogEntry | undefined {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) {
    return PROVIDER_CATALOG.find((e) => {
      const eu = new URL(e.endpoint);
      return LOCAL_HOSTS.has(eu.hostname) && portOf(eu) === portOf(u);
    });
  }
  return PROVIDER_CATALOG.find((e) =>
    e.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );
}
