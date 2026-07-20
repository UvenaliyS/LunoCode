import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

/**
 * Luno gateway — MOCK.
 *
 * Implements the contract the extension talks to so the whole UX can be built
 * and demoed before the real backend exists:
 *   POST /auth/device/start  -> { userCode, deviceCode, verificationUri, ... }
 *   POST /auth/device/poll   -> { status: pending|approved|expired|denied }
 *   GET  /models             -> { models, nonLogging }
 *   GET  /usage              -> UsageSnapshot
 *   POST /chat               -> text/event-stream of { delta } then { sonnetEqCost }
 *   POST /agent/plan         -> { steps } (SSH-flavored when the prompt asks)
 *
 * It ALSO speaks the three custom-provider wire formats so a "custom provider"
 * can be pointed at this same mock to demo the connection test + streaming:
 *   GET  /v1/models          -> OpenAI list shape (401 on key "sk-bad")
 *   POST /v1/messages        -> Anthropic Messages SSE  (claude-code)
 *   POST /v1/responses       -> OpenAI Responses SSE    (codex)
 *   POST /v1/chat/completions-> OpenAI Chat Completions SSE (openai-v1)
 *   GET  /ping               -> { ok, ts }
 *
 * Auth in the mock is intentionally fake: device codes auto-approve after a few
 * seconds so there's no real Telegram bot needed locally. Swap this whole file
 * for the real gateway later; the HTTP contract stays the same.
 */

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const STUDIO_BASE_URL =
  process.env.STUDIO_BASE_URL ?? "https://luno.codes";

// --- Code format -------------------------------------------------------------

// Human-readable alphabet: A-Z + 2-9, minus look-alikes (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generate an XXXX-XXXX user code (8 chars, dash in the middle). */
function genUserCode() {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += "-";
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Normalize a code for comparison: upper-case, strip dashes/whitespace. */
function normalizeCode(code) {
  return String(code ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}

// --- Mock data ---------------------------------------------------------------

// Realistic, current model ids so the client's brand detection + icons show off
// across all four brands (claude/gpt/gemini/grok — see inferModelBrand in
// packages/shared). sonnetEq is the cost multiplier relative to Sonnet (=1).
const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", sonnetEq: 1 },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", sonnetEq: 5 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", sonnetEq: 0.3 },
  { id: "gpt-5.2", label: "GPT-5.2", sonnetEq: 1.2 },
  { id: "gpt-5-codex", label: "GPT-5 Codex", sonnetEq: 1 },
  { id: "gemini-3-pro", label: "Gemini 3 Pro", sonnetEq: 0.9 },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", sonnetEq: 0.2 },
  { id: "grok-4", label: "Grok 4", sonnetEq: 1 },
];

const PLAN = "POWER";
const LIMITS = {
  fiveHourLimit: 2_000_000,
  weeklyLimit: 15_000_000,
  totalLimit: 50_000_000,
  concurrency: 4,
  priority: 4,
};

// In-memory state (resets on restart — it's a mock).
const usage = {
  fiveHourUsed: 640_000,
  weeklyUsed: 3_800_000,
  totalUsed: 12_400_000,
};
/** deviceCode -> { createdAt, approveAt, apiKey } */
const devices = new Map();

const AUTO_APPROVE_MS = 4000; // pretend the user confirmed in the bot
const CODE_TTL_MS = 5 * 60_000;

// --- Helpers -----------------------------------------------------------------

function send(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function usageSnapshot() {
  const now = Date.now();
  return {
    plan: PLAN,
    limits: LIMITS,
    buckets: [
      {
        id: "fiveHour",
        label: "5-hour",
        used: usage.fiveHourUsed,
        limit: LIMITS.fiveHourLimit,
        resetAt: now + 3 * 3600_000,
      },
      {
        id: "weekly",
        label: "Weekly",
        used: usage.weeklyUsed,
        limit: LIMITS.weeklyLimit,
        resetAt: now + 5 * 24 * 3600_000,
      },
      {
        id: "total",
        label: "Subscription",
        used: usage.totalUsed,
        limit: LIMITS.totalLimit,
        resetAt: now + 22 * 24 * 3600_000,
      },
    ],
    // Overview extras (site dashboard parity) — optional in the contract.
    bonusBalance: 4.2,
    rpmLimit: 60,
    requestsToday: 137,
    requestsMonth: 2841,
  };
}

// A canned, lightly-dynamic assistant reply for the mock.
function mockReply(messages, model) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const q = last?.content ?? "";
  return (
    `**Mock Luno reply** (model: \`${model}\`).\n\n` +
    `You said: “${q.slice(0, 200)}”.\n\n` +
    `The real gateway will stream a model response here. For now this proves ` +
    `the full path: webview → extension → gateway → streamed tokens → usage ` +
    `meter update.`
  );
}

// --- Format-compat helpers ---------------------------------------------------
//
// A "custom provider" can be pointed at this same mock so the new provider UX
// (connection test + streaming in every wire format) can be demoed without a
// real backend. We speak all three ProviderFormat protocols (see packages/
// shared): Anthropic Messages (/v1/messages), OpenAI Responses (/v1/responses),
// and OpenAI Chat Completions (/v1/chat/completions), plus an OpenAI-shaped
// model list (/v1/models). Every one of them reuses mockReply + streamTokens.

/** Split text into word-ish tokens (word + trailing whitespace). */
function tokenize(text) {
  return text.match(/\S+\s*/g) ?? [text];
}

/**
 * Extract the presented API key from either header style, for the fake
 * key-validation demo. Returns the raw key string or "" if none.
 *   - Authorization: Bearer sk-...
 *   - x-api-key: sk-...
 */
function apiKeyFrom(req) {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.trim()) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  const xkey = req.headers["x-api-key"];
  return typeof xkey === "string" ? xkey.trim() : "";
}

/** The one magic key the UI uses to demo a failed connection test. */
const BAD_KEY = "sk-bad";

/** Open an SSE stream with the shared CORS/no-cache headers. */
function openSse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
}

/**
 * Stream `text` word-by-word over an already-opened SSE response at ~30ms
 * cadence. `frame(word)` maps each token to the SSE payload line(s) for the
 * given wire format; `done()` writes the format's terminator and ends. Shared
 * by all four streaming endpoints so cadence/behaviour stay identical.
 */
function streamTokens(req, res, text, frame, done) {
  const tokens = tokenize(text);
  let i = 0;
  const timer = setInterval(() => {
    if (i < tokens.length) {
      res.write(frame(tokens[i++]));
      return;
    }
    clearInterval(timer);
    done();
    res.end();
  }, 30);
  req.on("close", () => clearInterval(timer));
}

// --- Routes ------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return send(res, 204, {}, {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-api-key",
    });
  }

  // --- Health probe (cheap; used by connection tests / liveness) ---
  if (req.method === "GET" && path === "/ping") {
    return send(res, 200, { ok: true, ts: Date.now() });
  }

  // --- Auth: device-code start ---
  if (req.method === "POST" && path === "/auth/device/start") {
    const userCode = genUserCode(); // XXXX-XXXX
    const deviceCode = randomBytes(16).toString("hex");
    devices.set(deviceCode, {
      createdAt: Date.now(),
      approveAt: Date.now() + AUTO_APPROVE_MS,
      apiKey: `sk-clau_${randomBytes(18).toString("base64url")}`,
    });
    return send(res, 200, {
      userCode,
      deviceCode,
      verificationUri: `https://t.me/LunoCodes?start=${deviceCode.slice(0, 12)}`,
      webVerificationUri: `${STUDIO_BASE_URL}/link?code=${encodeURIComponent(userCode)}`,
      expiresIn: CODE_TTL_MS / 1000,
      interval: 2,
    });
  }

  // --- Auth: device-code poll ---
  if (req.method === "POST" && path === "/auth/device/poll") {
    const { deviceCode } = await readJson(req);
    const entry = devices.get(deviceCode);
    if (!entry) return send(res, 200, { status: "denied" });
    if (Date.now() - entry.createdAt > CODE_TTL_MS) {
      devices.delete(deviceCode);
      return send(res, 200, { status: "expired" });
    }
    if (Date.now() >= entry.approveAt) {
      devices.delete(deviceCode);
      return send(res, 200, {
        status: "approved",
        apiKey: entry.apiKey,
        plan: PLAN,
      });
    }
    return send(res, 200, { status: "pending" });
  }

  // --- Auth: verify a pasted API key ---
  if (req.method === "POST" && path === "/auth/key/verify") {
    const { apiKey } = await readJson(req);
    // The client never validates key format — that's the backend's job (a key
    // is valid iff it exists and isn't revoked). Mock: accept any non-empty key.
    const valid = typeof apiKey === "string" && apiKey.trim().length > 0;
    return send(res, 200, valid ? { valid: true, plan: PLAN } : { valid: false });
  }

  // --- Auth: exchange a browser-OAuth one-time token for an API key ---
  if (req.method === "POST" && path === "/auth/oauth/exchange") {
    const { token } = await readJson(req);
    // Mock semantics: any non-empty token exchanges successfully.
    if (typeof token === "string" && token.length > 0) {
      return send(res, 200, {
        apiKey: `sk-clau_${randomBytes(18).toString("base64url")}`,
        plan: PLAN,
      });
    }
    return send(res, 400, { error: "invalid or expired token" });
  }

  // --- Models ---
  if (req.method === "GET" && path === "/models") {
    return send(res, 200, { models: MODELS, nonLogging: true });
  }

  // --- Usage ---
  if (req.method === "GET" && path === "/usage") {
    return send(res, 200, usageSnapshot());
  }

  // --- Account profile (what the cabinet shows: name/email/avatar token) ---
  if (req.method === "GET" && path === "/account/me") {
    return send(res, 200, {
      name: "Uvena",
      email: "uvena@luno.codes",
      // The site's generated-avatar token: luno:<palette 0-49>:<icon 0-14>.
      avatar: "luno:7:0",
      plan: PLAN.toLowerCase(),
      planExpiresAt: Date.now() + 26 * 24 * 3600_000,
    });
  }

  // === Format-compat endpoints =============================================
  // These let a "custom provider" (any ProviderFormat) be pointed at this same
  // mock and pass the new connection test + stream. Present `sk-bad` as the key
  // to any of them to demo key-validation failure (401).

  // OpenAI-shaped model list. The provider connection test lists models here.
  if (req.method === "GET" && path === "/v1/models") {
    if (apiKeyFrom(req) === BAD_KEY) {
      return send(res, 401, { error: { message: "invalid api key" } });
    }
    return send(res, 200, {
      object: "list",
      data: MODELS.map((m) => ({ id: m.id, object: "model" })),
    });
  }

  // Anthropic Messages (claude-code format): SSE with message_start,
  // content_block_delta text_delta frames, then message_stop.
  if (req.method === "POST" && path === "/v1/messages") {
    const body = await readJson(req);
    if (apiKeyFrom(req) === BAD_KEY) {
      return send(res, 401, { error: { message: "invalid api key" } });
    }
    const model = body.model ?? "claude-sonnet-4-6";
    const text = mockReply(body.messages ?? [], model);
    openSse(res);
    // Anthropic emits a named event line + a data line per frame.
    res.write(
      `event: message_start\n` +
        `data: ${JSON.stringify({
          type: "message_start",
          message: { id: `msg_${randomBytes(8).toString("hex")}`, role: "assistant", model },
        })}\n\n`,
    );
    streamTokens(
      req,
      res,
      text,
      (word) =>
        `event: content_block_delta\n` +
        `data: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: word },
        })}\n\n`,
      () => {
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      },
    );
    return;
  }

  // OpenAI Responses (codex format): SSE with response.output_text.delta
  // frames, then response.completed.
  if (req.method === "POST" && path === "/v1/responses") {
    const body = await readJson(req);
    if (apiKeyFrom(req) === BAD_KEY) {
      return send(res, 401, { error: { message: "invalid api key" } });
    }
    const model = body.model ?? "gpt-5-codex";
    const text = mockReply(body.messages ?? body.input ?? [], model);
    openSse(res);
    streamTokens(
      req,
      res,
      text,
      (word) =>
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: word })}\n\n`,
      () => {
        res.write(`data: ${JSON.stringify({ type: "response.completed" })}\n\n`);
      },
    );
    return;
  }

  // OpenAI Chat Completions (openai-v1 format): SSE with choices[].delta.content
  // chunks, then a literal `data: [DONE]`.
  if (req.method === "POST" && path === "/v1/chat/completions") {
    const body = await readJson(req);
    if (apiKeyFrom(req) === BAD_KEY) {
      return send(res, 401, { error: { message: "invalid api key" } });
    }
    const model = body.model ?? "gpt-5.2";
    const text = mockReply(body.messages ?? [], model);
    openSse(res);
    streamTokens(
      req,
      res,
      text,
      (word) =>
        `data: ${JSON.stringify({
          object: "chat.completion.chunk",
          model,
          choices: [{ index: 0, delta: { content: word } }],
        })}\n\n`,
      () => {
        res.write("data: [DONE]\n\n");
      },
    );
    return;
  }

  // --- Agent plan (MOCK) ---
  // Returns a concrete, executable plan so the observable-execution UI works
  // end-to-end before a real model is wired in: inspect the workspace, read a
  // file, then propose a real edit (gated by approval on the client).
  if (req.method === "POST" && path === "/agent/plan") {
    const { prompt = "" } = await readJson(req);
    const stamp = new Date().toISOString();

    // SSH-flavored variant: when the prompt is about servers/deploy, return a
    // plan that exercises the SSH subsystem UI (list → interactive pick → exec
    // → summarize). NOTE: the extension runner substitutes the "$picked"
    // placeholder in sshExec.input.serverId with the id the user chose in the
    // sshPick step — the mock just emits the literal placeholder.
    if (/ssh|server|deploy|сервер|деплой/i.test(String(prompt))) {
      return send(res, 200, {
        steps: [
          { kind: "thinking", title: "Checking configured SSH servers" },
          { kind: "tool", tool: "sshList", title: "List SSH servers", input: {} },
          {
            kind: "tool",
            tool: "sshPick",
            title: "Pick server(s) to work on",
            input: { prompt: "Which server(s) should I work on?", multi: true },
          },
          {
            kind: "tool",
            tool: "sshExec",
            title: "Check uptime & disk usage",
            // "$picked" is resolved to the picked server id by the client runner.
            input: { serverId: "$picked", command: "uptime && df -h | head -5" },
          },
          { kind: "thinking", title: "Summarizing server status" },
        ],
      });
    }

    return send(res, 200, {
      steps: [
        {
          kind: "thinking",
          title: `Planning: ${String(prompt).slice(0, 80) || "task"}`,
        },
        { kind: "tool", tool: "listDir", title: "List workspace root", input: { path: "." } },
        {
          kind: "tool",
          tool: "runCommand",
          title: "Show current directory",
          input: { command: process.platform === "win32" ? "Get-Location" : "pwd" },
        },
        {
          kind: "tool",
          tool: "writeFile",
          title: "Write LUNO_AGENT_DEMO.md",
          input: {
            path: "LUNO_AGENT_DEMO.md",
            content: `# Luno agent demo\n\nCreated by the mock agent at ${stamp}.\n\nPrompt: ${String(prompt).slice(0, 200)}\n`,
          },
        },
      ],
    });
  }

  // --- Chat (streamed SSE) ---
  if (req.method === "POST" && path === "/chat") {
    const { model = "claude-sonnet-4-6", messages = [] } = await readJson(req);
    const text = mockReply(messages, model);
    const coeff = MODELS.find((m) => m.id === model)?.sonnetEq ?? 1;

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });

    const tokens = text.match(/\S+\s*/g) ?? [text];
    let i = 0;
    const timer = setInterval(() => {
      if (i < tokens.length) {
        res.write(`data: ${JSON.stringify({ delta: tokens[i++] })}\n\n`);
        return;
      }
      clearInterval(timer);
      // Charge usage: roughly proportional to output length × model coefficient.
      const cost = Math.round(tokens.length * 120 * coeff);
      usage.fiveHourUsed += cost;
      usage.weeklyUsed += cost;
      usage.totalUsed += cost;
      const sonnetEq = +(tokens.length * 0.12 * coeff).toFixed(2);
      res.write(`data: ${JSON.stringify({ sonnetEqCost: sonnetEq })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }, 35);

    req.on("close", () => clearInterval(timer));
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[luno-gateway:mock] listening on http://${HOST}:${PORT}`);
  console.log("  device codes auto-approve after ~4s (no real bot needed)");
  console.log("  custom-provider formats live at /v1/* (key 'sk-bad' -> 401)");
});
