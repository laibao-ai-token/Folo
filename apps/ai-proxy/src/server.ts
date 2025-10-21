import fs from "node:fs"

import { createOpenAI } from "@ai-sdk/openai"
import { serve } from "@hono/node-server"
import { convertToCoreMessages, streamText } from "ai"
import { config as dotenvConfig } from "dotenv"
import type { Context } from "hono"
import { Hono } from "hono"
import { cors } from "hono/cors"

// Load env from .env.local first, then .env
if (fs.existsSync(".env.local")) {
  dotenvConfig({ path: ".env.local", override: true })
}
dotenvConfig()

const IFLOW_BASE_URL = "https://apis.iflow.cn/v1"
// Upstream Follow API for resolving context ("Current" entry content)
const UPSTREAM_API_URL =
  process.env.UPSTREAM_API_URL || process.env.FOLLOW_API_URL || "https://api.follow.is"

const app = new Hono()

// Basic CORS setup: reflect origin and allow credentials
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
    allowHeaders: ["Content-Type", "X-Client-Id", "X-Session-Id"],
    exposeHeaders: ["Content-Type"],
  }),
)

// Health check
app.get("/health", (c) => c.json({ ok: true }))

// Utility: build upstream headers with best-effort auth + tracing
const buildUpstreamHeaders = (c: Context): Record<string, string> => {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-App-Name": "Folo AI Proxy",
    "X-App-Version": "0.1.0",
    "X-App-Platform": "desktop/web",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Folo",
  }

  // Forward tracing headers from client when present
  const xClientId = c.req.header("x-client-id")
  const xSessionId = c.req.header("x-session-id")
  if (xClientId) headers["X-Client-Id"] = xClientId
  if (xSessionId) headers["X-Session-Id"] = xSessionId

  // Attach upstream auth if provided (env takes precedence)
  const upstreamSession = process.env.UPSTREAM_SESSION_TOKEN
  const headerSession = c.req.header("x-upstream-session")
  if (upstreamSession || headerSession) {
    headers["Cookie"] = `__Secure-better-auth.session_token=${headerSession || upstreamSession}`
  } else {
    // best-effort forward the raw cookie from incoming request (may not include upstream session)
    const rawCookie = c.req.header("cookie") || c.req.header("Cookie")
    if (rawCookie) headers["Cookie"] = rawCookie
  }
  return headers
}

// Local proxy routes so Current-context resolution also goes through this server
app.get("/proxy/entries", async (c) => {
  const url = new URL(c.req.url)
  const id = url.searchParams.get("id") || ""
  const target = `${UPSTREAM_API_URL}/entries?id=${encodeURIComponent(id)}`
  try {
    const res = await fetch(target, { headers: buildUpstreamHeaders(c) })
    const data = await res.text()
    return c.body(data, res.status, {
      "content-type": res.headers.get("content-type") || "application/json",
    })
  } catch (e: any) {
    console.warn("[ai-proxy] /proxy/entries error", e?.message || e)
    return c.json({ ok: false, message: "proxy error" }, 502)
  }
})

app.get("/proxy/entries/readability", async (c) => {
  const url = new URL(c.req.url)
  const id = url.searchParams.get("id") || ""
  const target = `${UPSTREAM_API_URL}/entries/readability?id=${encodeURIComponent(id)}`
  try {
    const res = await fetch(target, { headers: buildUpstreamHeaders(c) })
    const data = await res.text()
    return c.body(data, res.status, {
      "content-type": res.headers.get("content-type") || "application/json",
    })
  } catch (e: any) {
    console.warn("[ai-proxy] /proxy/entries/readability error", e?.message || e)
    return c.json({ ok: false, message: "proxy error" }, 502)
  }
})

// Core chat endpoint used by the desktop app
app.post("/ai/chat", async (c) => {
  const apiKey = process.env.IFLOW_API_KEY
  if (!apiKey) {
    return c.json({ error: "IFLOW_API_KEY is not set" }, 500)
  }

  // Create provider per-request to allow different keys/environments later
  const openai = createOpenAI({ apiKey, baseURL: IFLOW_BASE_URL })

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON" }, 400)
  }

  const { messages, model: modelString, scene, temperature: reqTemperature } = body || {}
  if (!Array.isArray(messages)) {
    return c.json({ error: "messages must be an array" }, 400)
  }

  // Accept both 'provider/model' and plain model id; allow override via DEFAULT_MODEL
  const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "gpt-4o-mini"
  // Normalize incoming model string: support `provider/model`, plain id, or "auto" (fallback to default)
  const sanitizeModel = (raw: unknown): string => {
    if (typeof raw !== "string") return DEFAULT_MODEL
    const s = raw.trim()
    if (!s || s.toLowerCase() === "auto") return DEFAULT_MODEL
    const parts = s.split("/")
    return parts.length > 1 ? parts.slice(1).join("/") : s
  }
  const requestedModel = typeof modelString === "string" ? modelString : undefined
  const modelId = sanitizeModel(modelString)

  // Language resolution: body.lang/language > custom header > Accept-Language > env > default 'zh-CN'
  const resolveLanguage = (): string => {
    const bodyLang: unknown = body?.language ?? body?.lang
    const headerLang = c.req.header("x-language") || c.req.header("x-lang")
    const accept = c.req.header("accept-language")
    const envLang = process.env.DEFAULT_RESPONSE_LANGUAGE
    const pick = (v?: string | null) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
    return pick(bodyLang as string) || pick(headerLang) || pick(accept) || envLang || "zh-CN"
  }
  const responseLanguage = resolveLanguage()

  // System prompt for timeline-summary / finance-analysis scenes with language-aware instruction
  const system =
    scene === "timeline-summary"
      ? responseLanguage.toLowerCase().startsWith("zh")
        ? [
            "请用简体中文对今天的时间线进行“覆盖全面且结构化”的总结。",
            "- 先用 1 句给出当天主线与基调。",
            "- 按章节分节输出（缺项可省略）：AI 模型与技术发布、AI 开发与实践、AI 理论与观点、平台与产品动态、安全事件、政治与社会动态。",
            "- 每节用项目符号列出要点：每条 1–2 句，说明发生了什么、为何重要；如有链接在行末给出。",
            "- 合并重复/转发/同源多帖为一条，保留代表性链接；尽量覆盖不同主题而不是只挑少数几条。",
            "- 保持中立克制，不引入输入之外的信息，不做臆测；事实不充分处标注“待确认/存疑”。",
            "- 目标长度：不少于 700 字；如信息较多，可扩展到 1200–1500 字；若仍有遗漏，在最后加一节“更多值得关注”。",
            "- 输出仅使用简体中文。",
          ].join("\n")
        : [
            "Summarize today's timeline with comprehensive coverage and clear structure.",
            "- Start with a one-line daily overview.",
            "- Use sections (omit if empty): AI Models & Tech, Dev & Practice, Theory & Opinions, Platforms & Product Updates, Security Incidents, Politics & Society.",
            "- Bullet points: 1–2 sentences each on what happened and why it matters; append links when available.",
            "- Merge duplicates/retweets/same-source items; cover as many distinct topics as possible.",
            "- Stay neutral; do not speculate or add info not present in context; mark uncertain items as such.",
            '- Target length: at least ~700 words, up to 1200–1500 when needed; add a final "More to watch" when there are notable leftovers.',
          ].join("\n")
      : scene === "finance-analysis"
        ? responseLanguage.toLowerCase().startsWith("zh")
          ? [
              "你是一名证券市场分析助手。以下是某只证券的最新报价和基础数值，请基于提供的数据进行客观分析。",
              "- 输出结构：",
              "  1) 核心结论（1–2 句）",
              "  2) 技术面要点（趋势、关键支撑/压力、波动特征；若缺历史数据，请据现有价、涨跌幅、振幅做保守判断）",
              "  3) 基本面/消息面提示（如财报、政策、行业供需，若无上下文仅提示“数据不足”）",
              "  4) 风险与不确定性",
              "  5) 接下来可关注的观察点/催化",
              "- 风格要求：中立、克制；不构成投资建议；不要捏造上下文没有的信息。",
            ].join("\n")
          : [
              "You are a markets analysis assistant. Analyze the following quote data objectively.",
              "- Structure:",
              "  1) Key takeaway (1–2 sentences)",
              "  2) Technical notes (trend, key support/resistance, volatility; when history is absent, infer conservatively from price/change/amplitude)",
              '  3) Fundamentals/news pointers (mark "insufficient data" when unknown)',
              "  4) Risks & uncertainties",
              "  5) What to watch next",
              "- Tone: neutral; no financial advice; avoid fabrications.",
            ].join("\n")
        : undefined

  // Helper: extract plain text from UIMessage parts (user + system)
  const extractPromptText = (msgs: any[]) => {
    const texts: string[] = []
    for (const m of msgs || []) {
      if (!m || (m.role !== "user" && m.role !== "system")) continue
      const parts: any[] = Array.isArray(m.parts) ? m.parts : []
      for (const p of parts) {
        if (p?.type === "text" && typeof p.text === "string") {
          texts.push(p.text)
        } else if (p?.type === "data-rich-text" && p.data && typeof p.data.text === "string") {
          texts.push(p.data.text)
        }
      }
    }
    return texts
  }

  const allTexts = extractPromptText(messages)
  const preview = allTexts.join("\n").slice(0, 200)

  // Optional verbose debug: print full prompt text (first 32k) for timeline-summary
  if (
    (process.env.DEBUG_AI_PROXY_PROMPT === "1" ||
      (process.env.DEBUG_AI_PROXY_PROMPT || "").toLowerCase() === "true") &&
    scene === "timeline-summary"
  ) {
    // eslint-disable-next-line no-console
    console.log(
      "[ai-proxy] DEBUG full prompt text (first 32k):\n",
      allTexts.join("\n").slice(0, 32000),
    )
  }

  // Lightweight request log for verification (with prompt preview)
  console.info("[ai-proxy] incoming /ai/chat", {
    model: modelId,
    requestedModel: requestedModel ?? null,
    scene: scene ?? null,
    messages: Array.isArray(messages) ? messages.length : 0,
    promptPreview: preview,
  })

  // Normalize UI messages and extract optional context blocks so models can see them.
  // - Map "data-rich-text" -> plain text
  // - Keep "file" as-is when possible
  // - Extract "data-block" (mainEntry) to fetch current entry content
  let mainEntryId: string | undefined
  let normalizedUIMessages = Array.isArray(messages)
    ? messages.map((m: any) => {
        const parts = Array.isArray(m?.parts) ? m.parts : []
        const normParts: any[] = []
        for (const p of parts) {
          if (p?.type === "text" && typeof p.text === "string") {
            normParts.push({ type: "text", text: p.text })
          } else if (p?.type === "data-rich-text" && p.data && typeof p.data.text === "string") {
            normParts.push({ type: "text", text: p.data.text })
          } else if (p?.type === "file") {
            // keep files in case provider supports them
            normParts.push({
              type: "file",
              mediaType: p.mediaType,
              filename: p.filename,
              url: p.url,
            })
          } else if (p?.type === "data-block" && Array.isArray(p.data)) {
            // Extract context blocks
            for (const block of p.data) {
              if (block && block.type === "mainEntry" && typeof block.value === "string") {
                mainEntryId = block.value
              }
            }
          }
          // ignore other custom parts (e.g., mainEntry/mainFeed) on proxy level
        }
        return { ...m, parts: normParts }
      })
    : []

  // Fallback: some clients may start a timeline-summary session with no user message.
  // Inject a minimal user message so providers that require non-empty prompts can proceed.
  if (normalizedUIMessages.length === 0) {
    const fallbackText =
      scene === "timeline-summary"
        ? "Summarize today's timeline concisely."
        : "Start the conversation."
    normalizedUIMessages = [{ role: "user", parts: [{ type: "text", text: fallbackText }] }]
  }

  // Detect if client already provided inline context text (so we can skip upstream fetch)
  const hasInlineContext = (() => {
    const firstUser = normalizedUIMessages.find((m: any) => m?.role === "user")
    const parts = Array.isArray(firstUser?.parts) ? firstUser.parts : []
    return parts.some(
      (p: any) =>
        p?.type === "text" &&
        typeof p.text === "string" &&
        p.text.startsWith("Context: Current entry"),
    )
  })()

  // If a main entry context is provided, fetch its content through the local proxy routes
  if (mainEntryId && normalizedUIMessages.length > 0 && !hasInlineContext) {
    const selfOrigin = (() => {
      try {
        const u = new URL(c.req.url)
        return u.origin
      } catch {
        const port = Number(process.env.PORT || 3000)
        return `http://127.0.0.1:${port}`
      }
    })()
    console.info("[ai-proxy] mainEntry detected", {
      entryId: mainEntryId,
      upstream: UPSTREAM_API_URL,
      via: `${selfOrigin}/proxy`,
    })
    try {
      const headers = buildUpstreamHeaders(c)

      // 1) Basic entry data (title/url/content)
      let title = ""
      let url = ""
      let htmlContent: string | undefined
      try {
        const res = await fetch(
          `${selfOrigin}/proxy/entries?id=${encodeURIComponent(mainEntryId)}`,
          {
            headers,
          },
        )
        if (res.ok) {
          const json: any = await res.json()
          const data = json?.data
          title = data?.entries?.title || ""
          url = data?.entries?.url || ""
          htmlContent = data?.entries?.content || data?.entries?.description || undefined
        } else {
          console.warn("[ai-proxy] entries fetch failed", { status: res.status })
        }
      } catch (e) {
        console.warn("[ai-proxy] entries fetch error", e)
      }

      // 2) Try readability content if not available
      if (!htmlContent) {
        try {
          const res2 = await fetch(
            `${selfOrigin}/proxy/entries/readability?id=${encodeURIComponent(mainEntryId)}`,
            { headers },
          )
          if (res2.ok) {
            const json2: any = await res2.json()
            htmlContent = json2?.data?.content || htmlContent
          } else {
            console.warn("[ai-proxy] readability fetch failed", { status: res2.status })
          }
        } catch (e) {
          console.warn("[ai-proxy] readability fetch error", e)
        }
      }

      // Fallback to empty when nothing fetched
      const plainText = (htmlContent || "")
        // Naive HTML -> text
        .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
        .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
        .replaceAll(/<[^>]+>/g, " ")
        .replaceAll(/\s+/g, " ")
        .trim()

      const metaLines = [
        "Context: Current entry",
        title ? `Title: ${title}` : undefined,
        url ? `URL: ${url}` : undefined,
      ].filter(Boolean)
      const contextText = [metaLines.join("\n"), "", plainText].join("\n").slice(0, 32000)

      // Attach to the first user message (or append a new one)
      const firstUserIndex = normalizedUIMessages.findIndex((m: any) => m?.role === "user")
      if (firstUserIndex !== -1) {
        const target = normalizedUIMessages[firstUserIndex]
        target.parts = Array.isArray(target.parts) ? target.parts : []
        target.parts.unshift({ type: "text", text: contextText })
      } else {
        normalizedUIMessages.unshift({ role: "user", parts: [{ type: "text", text: contextText }] })
      }

      // eslint-disable-next-line no-console
      console.log("[ai-proxy] injected current entry", {
        entryId: mainEntryId,
        title: title || null,
        url: url || null,
        textLength: plainText.length,
      })

      if (
        process.env.DEBUG_AI_PROXY_CONTEXT === "1" ||
        (process.env.DEBUG_AI_PROXY_CONTEXT || "").toLowerCase() === "true"
      ) {
        // eslint-disable-next-line no-console
        console.log("[ai-proxy] DEBUG current-entry context (first 32k):\n", contextText)
      }
    } catch (e) {
      console.warn("[ai-proxy] failed to resolve current entry context", e)
    }
  }
  if (mainEntryId && hasInlineContext) {
    console.info("[ai-proxy] inline current entry context detected — skipping upstream fetch", {
      entryId: mainEntryId,
    })
  }

  // Use Chat Completions endpoint explicitly for OpenAI-compatible providers like iflow
  // Resolve max output tokens with sensible defaults (to avoid truncated summaries)
  const reqMaxOutputTokensRaw = (body && (body.maxOutputTokens ?? body.max_tokens)) as
    | number
    | undefined
  const reqMaxOutputTokens =
    typeof reqMaxOutputTokensRaw === "number" && Number.isFinite(reqMaxOutputTokensRaw)
      ? reqMaxOutputTokensRaw
      : undefined
  const envDefaultMax = process.env.DEFAULT_MAX_OUTPUT_TOKENS
    ? Number(process.env.DEFAULT_MAX_OUTPUT_TOKENS)
    : undefined
  const defaultMaxForScene = scene === "timeline-summary" ? 1200 : undefined

  const finalMaxOutputTokens =
    (reqMaxOutputTokens ?? envDefaultMax ?? defaultMaxForScene)
      ? Number(reqMaxOutputTokens ?? envDefaultMax ?? defaultMaxForScene)
      : undefined

  const result = streamText({
    model: openai.chat(modelId),
    messages: convertToCoreMessages(normalizedUIMessages),
    ...(system ? { system } : {}),
    // Temperature precedence: request > env > provider default
    ...(reqTemperature != null
      ? { temperature: Number(reqTemperature) }
      : process.env.DEFAULT_TEMPERATURE
        ? { temperature: Number(process.env.DEFAULT_TEMPERATURE) }
        : {}),
    // Allow larger outputs to reduce truncation in timeline summaries
    ...(finalMaxOutputTokens ? { maxOutputTokens: finalMaxOutputTokens } : {}),
  })

  // Return as AI SDK UI Message stream (SSE JSON events)
  // Log chosen output token cap for diagnostics
  if (process.env.DEBUG_AI_PROXY_PROMPT) {
    // eslint-disable-next-line no-console
    console.log("[ai-proxy] using maxOutputTokens:", finalMaxOutputTokens ?? "(provider default)")
  }

  return result.toUIMessageStreamResponse({
    // Provide error text for the UI stream schema to avoid client-side
    // validation failures when an error event is emitted.
    onError: (err) => {
      console.error("[ai-proxy] /ai/chat error:", err?.message || err)
      const message =
        typeof err === "string"
          ? err
          : err && typeof (err as any).message === "string"
            ? (err as any).message
            : "Unknown error"
      return message
    },
  })
})

// Optional: unimplemented reconnect endpoint — reply 204
app.get("/ai/chat/:id/stream", (c) => c.body(null, 204))

const port = Number(process.env.PORT || 3000)
serve({ fetch: app.fetch, port })
// eslint-disable-next-line no-console
console.log(`[ai-proxy] listening on http://localhost:${port}`)
