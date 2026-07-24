import { useId, useState, type ComponentType } from "react";
import type { ModelInfo } from "../contracts";

interface IconProps {
  size?: number;
  className?: string;
}

/** Brand glyphs inlined (copied from the website /icons) so they render the same
 *  in the browser preview and inside the real VS Code webview — no asset URIs. */

export function ClaudeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fill="#D97757"
        fillRule="nonzero"
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
      />
    </svg>
  );
}

export function OpenAIIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#e4e4e7" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872v.024zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66v.018zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681l-.004 6.73zm1.097-2.365l2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5-.005-3z" />
    </svg>
  );
}

export function GeminiIcon({ size = 16, className }: IconProps) {
  // Real Gemini spark with the multi-stop gradients from the site icon.
  // Unique gradient ids per instance so a hidden copy never breaks the others.
  const uid = useId().replace(/:/g, "");
  const g0 = `${uid}-g0`;
  const g1 = `${uid}-g1`;
  const g2 = `${uid}-g2`;
  const d =
    "M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d={d} fill="#3186FF" />
      <path d={d} fill={`url(#${g0})`} />
      <path d={d} fill={`url(#${g1})`} />
      <path d={d} fill={`url(#${g2})`} />
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id={g0} x1="7" x2="11" y1="15.5" y2="12">
          <stop stopColor="#08B962" />
          <stop offset="1" stopColor="#08B962" stopOpacity="0" />
        </linearGradient>
        <linearGradient gradientUnits="userSpaceOnUse" id={g1} x1="8" x2="11.5" y1="5.5" y2="11">
          <stop stopColor="#F94543" />
          <stop offset="1" stopColor="#F94543" stopOpacity="0" />
        </linearGradient>
        <linearGradient gradientUnits="userSpaceOnUse" id={g2} x1="3.5" x2="17.5" y1="13.5" y2="12">
          <stop stopColor="#FABC12" />
          <stop offset=".46" stopColor="#FABC12" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Generic fallback — a small filled square, for models with no known brand. */
export function GenericModelIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#a1a1aa" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  );
}

function VendorIcon({
  size = 16,
  className,
  mark,
  color,
}: IconProps & { mark: string; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill={color} />
      <text x="12" y="15.5" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700" fontFamily="Arial, sans-serif">
        {mark}
      </text>
    </svg>
  );
}

const GrokIcon = (p: IconProps) => <VendorIcon {...p} mark="X" color="#18181b" />;
const DeepSeekIcon = (p: IconProps) => <VendorIcon {...p} mark="DS" color="#4d6bfe" />;
const KimiIcon = (p: IconProps) => <VendorIcon {...p} mark="K" color="#16181d" />;
const MistralIcon = (p: IconProps) => <VendorIcon {...p} mark="M" color="#f97316" />;
const MetaIcon = (p: IconProps) => <VendorIcon {...p} mark="∞" color="#0866ff" />;
const MicrosoftIcon = (p: IconProps) => <VendorIcon {...p} mark="MS" color="#107c10" />;
const QwenIcon = (p: IconProps) => <VendorIcon {...p} mark="Q" color="#615ced" />;
const CohereIcon = (p: IconProps) => <VendorIcon {...p} mark="C" color="#39594d" />;

export interface Brand {
  key: string;
  label: string;
  Icon: ComponentType<IconProps>;
  order: number;
}

function assetIcon(file: string, Fallback: ComponentType<IconProps>) {
  return function ModelAssetIcon({ size = 16, className }: IconProps) {
    const [failed, setFailed] = useState(false);
    if (failed) return <Fallback size={size} className={className} />;
    const base =
      (globalThis as typeof globalThis & {
        __LUNO_MODEL_ASSETS__?: string;
      }).__LUNO_MODEL_ASSETS__ ?? "models/";
    return (
      <img
        src={`${base}${file}.svg`}
        width={size}
        height={size}
        className={className}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    );
  };
}

const ModelIcons = {
  openai: assetIcon("openai", OpenAIIcon),
  google: assetIcon("gemini", GeminiIcon),
  anthropic: assetIcon("claude", ClaudeIcon),
  xai: assetIcon("grok", GrokIcon),
  deepseek: assetIcon("deepseek", DeepSeekIcon),
  kimi: assetIcon("kimi", KimiIcon),
  mistral: assetIcon("mistral", MistralIcon),
  meta: assetIcon("llama", MetaIcon),
  microsoft: assetIcon("microsoft", MicrosoftIcon),
  qwen: assetIcon("qwen", QwenIcon),
  cohere: assetIcon("cohere", CohereIcon),
  perplexity: assetIcon("perplexity", GenericModelIcon),
  amazon: assetIcon("amazon", GenericModelIcon),
  nvidia: assetIcon("nvidia", GenericModelIcon),
  zhipu: assetIcon("zhipu", GenericModelIcon),
  minimax: assetIcon("minimax", GenericModelIcon),
  gemma: assetIcon("gemma", GenericModelIcon),
  ibm: assetIcon("ibm", GenericModelIcon),
  ai21: assetIcon("ai21", GenericModelIcon),
  yi: assetIcon("yi", GenericModelIcon),
  baichuan: assetIcon("baichuan", GenericModelIcon),
  falcon: assetIcon("falcon", GenericModelIcon),
  databricks: assetIcon("databricks", GenericModelIcon),
  nous: assetIcon("nous", GenericModelIcon),
  liquid: assetIcon("liquid", GenericModelIcon),
  tencent: assetIcon("tencent", GenericModelIcon),
  baidu: assetIcon("baidu", GenericModelIcon),
  bytedance: assetIcon("bytedance", GenericModelIcon),
  stepfun: assetIcon("stepfun", GenericModelIcon),
  reka: assetIcon("reka", GenericModelIcon),
  cerebras: assetIcon("cerebras", GenericModelIcon),
  internlm: assetIcon("internlm", GenericModelIcon),
  upstage: assetIcon("upstage", GenericModelIcon),
  lg: assetIcon("lg", GenericModelIcon),
  huggingface: assetIcon("huggingface", GenericModelIcon),
  stability: assetIcon("stability", GenericModelIcon),
  azure: assetIcon("azure", GenericModelIcon),
};

/** Infer the provider brand from a model's id/label (gateway models all report
 *  providerId "luno", so we sniff the name instead). Drives the icon + grouping. */
export function modelBrand(m: ModelInfo): Brand {
  const s = `${m.id} ${m.label}`.toLowerCase();
  if (/(azure|microsoft[.\s/_-]*foundry)/.test(s)) return { key: "azure", label: "Azure AI", Icon: ModelIcons.azure, order: 11 };
  if (/(perplexity|sonar(?:[\s_-]|$))/i.test(s)) return { key: "perplexity", label: "Perplexity", Icon: ModelIcons.perplexity, order: 11 };
  if (/(amazon[.\s/_-]*nova|nova[-_. ]?(?:micro|lite|pro|premier|sonic)|amazon[.\s/_-]*titan)/.test(s)) return { key: "amazon", label: "Amazon", Icon: ModelIcons.amazon, order: 12 };
  if (/(nemotron|nvidia)/.test(s)) return { key: "nvidia", label: "NVIDIA", Icon: ModelIcons.nvidia, order: 13 };
  if (/(chatglm|glm[-_. ]?\d|zhipu|z\.ai)/.test(s)) return { key: "zhipu", label: "Zhipu AI", Icon: ModelIcons.zhipu, order: 14 };
  if (/minimax|abab[-_. ]?\d/.test(s)) return { key: "minimax", label: "MiniMax", Icon: ModelIcons.minimax, order: 15 };
  if (/(^|[\s/_.-])gemma(?:[\s/_.-]|$)/.test(s)) return { key: "gemma", label: "Google Gemma", Icon: ModelIcons.gemma, order: 16 };
  if (/(granite|ibm)/.test(s)) return { key: "ibm", label: "IBM", Icon: ModelIcons.ibm, order: 17 };
  if (/(jamba|jurassic|ai21)/.test(s)) return { key: "ai21", label: "AI21 Labs", Icon: ModelIcons.ai21, order: 18 };
  if (/(^|[\s/_.-])yi(?:[\s/_.-]|\d|$)|01[\s_-]?ai/.test(s)) return { key: "yi", label: "01.AI", Icon: ModelIcons.yi, order: 19 };
  if (/baichuan/.test(s)) return { key: "baichuan", label: "Baichuan", Icon: ModelIcons.baichuan, order: 20 };
  if (/(falcon|tiiuae)/.test(s)) return { key: "falcon", label: "Falcon", Icon: ModelIcons.falcon, order: 21 };
  if (/(dbrx|databricks)/.test(s)) return { key: "databricks", label: "Databricks", Icon: ModelIcons.databricks, order: 22 };
  if (/(hermes|nousresearch|nous)/.test(s)) return { key: "nous", label: "Nous Research", Icon: ModelIcons.nous, order: 23 };
  if (/(liquid|lfm[-_. ]?\d)/.test(s)) return { key: "liquid", label: "Liquid AI", Icon: ModelIcons.liquid, order: 24 };
  if (/(hunyuan|tencent)/.test(s)) return { key: "tencent", label: "Tencent", Icon: ModelIcons.tencent, order: 25 };
  if (/(ernie|wenxin|baidu)/.test(s)) return { key: "baidu", label: "Baidu", Icon: ModelIcons.baidu, order: 26 };
  if (/(doubao|seed[-_. ]?\d|bytedance|byte[-_. ]?dance)/.test(s)) return { key: "bytedance", label: "ByteDance", Icon: ModelIcons.bytedance, order: 27 };
  if (/(stepfun|step[-_. ]?\d)/.test(s)) return { key: "stepfun", label: "StepFun", Icon: ModelIcons.stepfun, order: 28 };
  if (/(reka(?:[\s/_.-]|$))/i.test(s)) return { key: "reka", label: "Reka AI", Icon: ModelIcons.reka, order: 29 };
  if (/(cerebras|zai[-_. ]?glm)/.test(s)) return { key: "cerebras", label: "Cerebras", Icon: ModelIcons.cerebras, order: 30 };
  if (/(internlm|internvl|上海人工智能实验室)/.test(s)) return { key: "internlm", label: "InternLM", Icon: ModelIcons.internlm, order: 31 };
  if (/(solar[-_. ]?(?:mini|pro)|upstage)/.test(s)) return { key: "upstage", label: "Upstage", Icon: ModelIcons.upstage, order: 32 };
  if (/(exaone|lg[-_. ]?ai)/.test(s)) return { key: "lg", label: "LG AI", Icon: ModelIcons.lg, order: 33 };
  if (/(bloomz?|smollm|bigscience)/.test(s)) return { key: "huggingface", label: "Hugging Face", Icon: ModelIcons.huggingface, order: 34 };
  if (/(stablelm|stability[-_. ]?ai)/.test(s)) return { key: "stability", label: "Stability AI", Icon: ModelIcons.stability, order: 35 };
  if (/(gpt|openai|codex|davinci)|(^|\s)o\d/.test(s)) return { key: "openai", label: "OpenAI", Icon: ModelIcons.openai, order: 1 };
  if (/(gemini|google|palm)/.test(s)) return { key: "google", label: "Google", Icon: ModelIcons.google, order: 2 };
  if (/(claude|opus|sonnet|haiku|fable|anthropic)/.test(s)) return { key: "anthropic", label: "Anthropic", Icon: ModelIcons.anthropic, order: 0 };
  if (/(grok|xai)/.test(s)) return { key: "xai", label: "xAI", Icon: ModelIcons.xai, order: 3 };
  if (/deepseek/.test(s)) return { key: "deepseek", label: "DeepSeek", Icon: ModelIcons.deepseek, order: 4 };
  if (/(kimi|moonshot)/.test(s)) return { key: "kimi", label: "Kimi", Icon: ModelIcons.kimi, order: 5 };
  if (/(mistral|mixtral|ministral)/.test(s)) return { key: "mistral", label: "Mistral", Icon: ModelIcons.mistral, order: 6 };
  if (/(llama|meta)/.test(s)) return { key: "meta", label: "Meta", Icon: ModelIcons.meta, order: 7 };
  if (/(phi|mai-|microsoft)/.test(s)) return { key: "microsoft", label: "Microsoft", Icon: ModelIcons.microsoft, order: 8 };
  if (/qwen/.test(s)) return { key: "qwen", label: "Qwen", Icon: ModelIcons.qwen, order: 9 };
  if (/(cohere|command-r)/.test(s)) return { key: "cohere", label: "Cohere", Icon: ModelIcons.cohere, order: 10 };
  return { key: "other", label: "Other", Icon: GenericModelIcon, order: 20 };
}
