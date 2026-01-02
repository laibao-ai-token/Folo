import fs from "node:fs"

import { createOpenAI } from "@ai-sdk/openai"
import { serve } from "@hono/node-server"
import { convertToCoreMessages, generateText, streamText } from "ai"
import { config as dotenvConfig } from "dotenv"
import type { Context } from "hono"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { dirname } from "pathe"

import {
  fetchEastmoneyCnQuote,
  fetchEastmoneyUsQuote,
  fetchUsKlineViaYahooServer,
} from "./finance/eastmoney"
// Load env from .env.local first, then .env
if (fs.existsSync(".env.local")) {
  dotenvConfig({ path: ".env.local", override: true })
}
dotenvConfig()

const IFLOW_BASE_URL =
  process.env.IFLOW_API_BASE_URL ||
  process.env.IFLOW_API_URL ||
  "https://codex-api-slb.packycode.com/v1"
// Upstream Follow API for resolving context ("Current" entry content)
const UPSTREAM_API_URL =
  process.env.UPSTREAM_API_URL || process.env.FOLLOW_API_URL || "https://api.follow.is"
// Optional Xiaohongshu MCP HTTP API base URL (e.g. http://127.0.0.1:18060/api/v1)
const XHS_API_BASE_URL = process.env.XHS_API_BASE_URL || ""

const isReasoningModelId = (modelId: string): boolean =>
  (modelId.startsWith("o") || modelId.startsWith("gpt-5")) && !modelId.startsWith("gpt-5-chat")

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  }
  return undefined
}

const parseReasoningEffort = (value: unknown): "low" | "medium" | "high" | undefined => {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized
  }
  return undefined
}

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

// Xiaohongshu recommended feeds proxy (simple JSON passthrough)
app.get("/xhs/feeds/recommended", async (c) => {
  if (!XHS_API_BASE_URL) {
    return c.json({ error: "XHS_API_BASE_URL is not configured" }, 500)
  }

  const limit = (c.req.query("limit") || "").trim()
  const concurrency = (c.req.query("concurrency") || "").trim()

  const base = XHS_API_BASE_URL.replace(/\/+$/, "")
  const url = new URL(`${base}/feeds/list_with_detail`)
  if (limit) url.searchParams.set("limit", limit)
  if (concurrency) url.searchParams.set("concurrency", concurrency)

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
      },
    })
    const text = await res.text()
    return c.body(text, res.status, {
      "content-type": res.headers.get("content-type") || "application/json",
    })
  } catch (e: any) {
    console.warn("[ai-proxy] /xhs/feeds/recommended error", e?.message || e)
    return c.json({ error: "xhs recommended feeds proxy error" }, 502)
  }
})

// Xiaohongshu search feeds proxy
app.get("/xhs/feeds/search", async (c) => {
  if (!XHS_API_BASE_URL) {
    return c.json({ error: "XHS_API_BASE_URL is not configured" }, 500)
  }

  const keyword = (c.req.query("keyword") || "").trim()
  if (!keyword) {
    return c.json({ error: "keyword is required" }, 400)
  }

  const base = XHS_API_BASE_URL.replace(/\/+$/, "")
  const url = new URL(`${base}/feeds/search`)
  url.searchParams.set("keyword", keyword)

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
      },
    })
    const text = await res.text()
    return c.body(text, res.status, {
      "content-type": res.headers.get("content-type") || "application/json",
    })
  } catch (e: any) {
    console.warn("[ai-proxy] /xhs/feeds/search error", e?.message || e)
    return c.json({ error: "xhs search feeds proxy error" }, 502)
  }
})

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

// Finance helper: proxy US quotes via Eastmoney to bypass browser/network blocking
app.get("/finance/us-quote", async (c) => {
  const symbol = (c.req.query("symbol") || "").trim()
  if (!symbol) return c.json({ error: "symbol is required" }, 400)
  try {
    const data = await fetchEastmoneyUsQuote(symbol)
    return c.json(data)
  } catch (e: any) {
    console.warn("[ai-proxy] /finance/us-quote error", e?.message || e)
    return c.json({ error: "us quote fetch failed" }, 502)
  }
})

// Finance helper: proxy CN quotes via Eastmoney
app.get("/finance/cn-quote", async (c) => {
  const code = (c.req.query("code") || "").trim()
  if (!code) return c.json({ error: "code is required" }, 400)
  try {
    const data = await fetchEastmoneyCnQuote(code)
    return c.json(data)
  } catch (e: any) {
    console.warn("[ai-proxy] /finance/cn-quote error", e?.message || e)
    return c.json({ error: "cn quote fetch failed" }, 502)
  }
})

// Finance helper: US kline via Yahoo with fallback
app.get("/finance/us-kline", async (c) => {
  const symbol = (c.req.query("symbol") || "").trim()
  const range = (c.req.query("range") || "5y").trim()
  const interval = (c.req.query("interval") || "1d").trim() as "1m" | "5m" | "1d" | "1wk" | "1mo"
  if (!symbol) return c.json({ error: "symbol is required" }, 400)
  try {
    const data = await fetchUsKlineViaYahooServer(symbol, { range, interval })
    return c.json(data)
  } catch (e: any) {
    console.warn("[ai-proxy] /finance/us-kline error", e?.message || e)
    return c.json({ error: "us kline fetch failed" }, 502)
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
  const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "qwen3-max"
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
  const imageAttachments: Array<{ url: string; mediaType: string; filename?: string }> = []
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
            // Inline local file:// to data URL so providers can consume
            let fileUrl: string | undefined = p.url
            try {
              if (typeof fileUrl === "string" && fileUrl.startsWith("file://")) {
                const filepath = fileUrl.replace(/^file:\/\//, "")
                const buf = fs.readFileSync(filepath)
                const base64 = buf.toString("base64")
                fileUrl = `data:${p.mediaType || "application/octet-stream"};base64,${base64}`
              }
            } catch (e) {
              console.warn("[ai-proxy] failed to inline local file in message", e)
            }
            const filePart = {
              type: "file",
              mediaType: p.mediaType,
              filename: p.filename,
              url: fileUrl,
            }
            normParts.push(filePart as any)
            // Collect image files for vision pipeline as well
            if (
              typeof p.mediaType === "string" &&
              p.mediaType.startsWith("image/") &&
              typeof p.url === "string" &&
              p.url
            ) {
              imageAttachments.push({
                url: p.url,
                mediaType: p.mediaType,
                filename: typeof p.filename === "string" ? p.filename : undefined,
              })
            }
          } else if (p?.type === "data-block" && Array.isArray(p.data)) {
            // Extract context blocks
            for (const block of p.data) {
              if (block && block.type === "mainEntry" && typeof block.value === "string") {
                mainEntryId = block.value
              } else if (
                block &&
                block.type === "fileAttachment" &&
                block.attachment &&
                typeof block.attachment?.serverUrl === "string" &&
                typeof block.attachment?.type === "string" &&
                block.attachment.serverUrl &&
                block.attachment.type
              ) {
                // Collect image attachments (for two-stage vision pipeline)
                const mediaType = String(block.attachment.type)
                if (mediaType.startsWith("image/")) {
                  imageAttachments.push({
                    url: String(block.attachment.serverUrl),
                    mediaType,
                    filename:
                      typeof block.attachment?.name === "string"
                        ? block.attachment.name
                        : undefined,
                  })
                }
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

  // If two-stage vision is enabled but we didn't receive explicit image attachments,
  // try to extract images from the entry content via local proxy (even when inline
  // context is provided), so the vision stage can still work for article pages.
  try {
    const enableTwoStage = (() => {
      const n = (process.env.ENABLE_TWO_STAGE_VISION || "").trim().toLowerCase()
      if (!n) return true // default: enabled
      return !["0", "false", "no", "off"].includes(n)
    })()

    if (enableTwoStage && imageAttachments.length === 0 && mainEntryId) {
      const selfOrigin = (() => {
        try {
          const u = new URL(c.req.url)
          return u.origin
        } catch {
          const port = Number(process.env.PORT || 3000)
          return `http://127.0.0.1:${port}`
        }
      })()

      const headers = buildUpstreamHeaders(c)
      let baseUrl = ""
      let htmlContent: string | undefined
      try {
        const res = await fetch(
          `${selfOrigin}/proxy/entries?id=${encodeURIComponent(mainEntryId)}`,
          { headers },
        )
        if (res.ok) {
          const json: any = await res.json()
          const data = json?.data
          baseUrl = data?.entries?.url || ""
          htmlContent = data?.entries?.content || data?.entries?.description || undefined
        }
      } catch (error) {
        console.warn("[ai-proxy] /proxy/entries fetch failed", error)
      }
      if (!htmlContent) {
        try {
          const res2 = await fetch(
            `${selfOrigin}/proxy/entries/readability?id=${encodeURIComponent(mainEntryId)}`,
            { headers },
          )
          if (res2.ok) {
            const json2: any = await res2.json()
            htmlContent = json2?.data?.content || htmlContent
          }
        } catch (error) {
          console.warn("[ai-proxy] /proxy/entries/readability fetch failed", error)
        }
      }

      if (htmlContent) {
        const abs = (u: string) => {
          try {
            return new URL(u, baseUrl || undefined).href
          } catch {
            return u
          }
        }
        const guessType = (u: string) => {
          const lower = u.toLowerCase()
          if (lower.endsWith(".png")) return "image/png"
          if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
          if (lower.endsWith(".webp")) return "image/webp"
          if (lower.endsWith(".gif")) return "image/gif"
          if (lower.endsWith(".svg")) return "image/svg+xml"
          return "image/*"
        }
        const urls = new Set<string>()
        // <img src="...">
        const imgSrcRe = /<img[^>]+src\s*=\s*['"]([^'"\s>]+)['"][^>]*>/gi
        let m: RegExpExecArray | null
        while ((m = imgSrcRe.exec(htmlContent))) {
          urls.add(abs(m[1]))
        }
        // common lazy attrs
        const lazyRe =
          /<img[^>]+(?:data-src|data-original|data-lazy-src)\s*=\s*['"]([^'"\s>]+)['"][^>]*>/gi
        while ((m = lazyRe.exec(htmlContent))) {
          urls.add(abs(m[1]))
        }
        // srcset (take the first candidate)
        const srcsetRe = /<img[^>]+srcset\s*=\s*['"]([^'"]+)['"][^>]*>/gi
        while ((m = srcsetRe.exec(htmlContent))) {
          const first = m[1].split(",")[0]?.trim().split(" ")[0]
          if (first) urls.add(abs(first))
        }
        // <source srcset>
        const sourceRe = /<source[^>]+srcset\s*=\s*['"]([^'"]+)['"][^>]*>/gi
        while ((m = sourceRe.exec(htmlContent))) {
          const first = m[1].split(",")[0]?.trim().split(" ")[0]
          if (first) urls.add(abs(first))
        }

        const collected = Array.from(urls)
          .filter((u) => /^(?:https?:)?\/\//.test(u))
          .slice(0, toNumber(process.env.VISION_MAX_IMAGES) ?? 4)
          .map((u) => ({ url: u, mediaType: guessType(u) }))

        if (collected.length > 0) {
          imageAttachments.push(...collected)
          console.info("[ai-proxy] collected entry images for vision", {
            count: collected.length,
          })
        }
      }
    }
  } catch (e) {
    console.warn("[ai-proxy] failed to collect entry images for vision", e)
  }

  // Optional: Two-stage vision pipeline — analyze image attachments with a vision model, then
  // inject the structured analysis as text context before delegating to the text model.
  try {
    const enableTwoStage = (() => {
      const n = (process.env.ENABLE_TWO_STAGE_VISION || "").trim().toLowerCase()
      if (!n) return true // default: enabled
      return !["0", "false", "no", "off"].includes(n)
    })()
    const visionModel = process.env.VISION_MODEL || "qwen3-vl-plus"
    // Deduplicate and cap number of images
    const uniqueImages: Array<{ url: string; mediaType: string; filename?: string }> = []
    const seen = new Set<string>()
    for (const img of imageAttachments) {
      if (!img?.url || seen.has(img.url)) continue
      seen.add(img.url)
      uniqueImages.push(img)
    }
    const maxImages = toNumber(process.env.VISION_MAX_IMAGES) ?? 4
    const selectedImages = uniqueImages.slice(0, Math.max(0, maxImages))

    // Optional: persist the first incoming image to a local path when configured
    const saveImagePath = (process.env.SAVE_IMAGE_PATH || "").trim()
    if (saveImagePath && selectedImages.length > 0) {
      const toBuffer = async (url: string): Promise<Buffer | null> => {
        try {
          if (url.startsWith("data:")) {
            const comma = url.indexOf(",")
            if (comma !== -1) {
              const b64 = url.slice(comma + 1)
              return Buffer.from(b64, "base64")
            }
            return null
          }
          if (url.startsWith("file://")) {
            const fp = url.replace(/^file:\/\//, "")
            return fs.readFileSync(fp)
          }
          const controller = new AbortController()
          const t = setTimeout(
            () => controller.abort(),
            Math.max(2000, toNumber(process.env.VISION_FETCH_TIMEOUT_MS) ?? 5000),
          )
          const res = await fetch(url, { signal: controller.signal })
          clearTimeout(t)
          if (!res.ok) return null
          const ab = await res.arrayBuffer()
          return Buffer.from(new Uint8Array(ab))
        } catch {
          return null
        }
      }

      try {
        const first = selectedImages[0]
        const buf: Buffer | null = await toBuffer(first.url)
        // If we couldn't fetch, skip silently
        if (buf) {
          fs.mkdirSync(dirname(saveImagePath), { recursive: true })
          fs.writeFileSync(saveImagePath, buf)
          console.info("[ai-proxy] saved incoming image to", saveImagePath)
        } else {
          console.warn("[ai-proxy] failed to save incoming image: no data")
        }
      } catch (e) {
        console.warn("[ai-proxy] save image error", e)
      }
    }

    if (enableTwoStage && visionModel && selectedImages.length > 0) {
      // Build a compact vision prompt and call non-streaming
      const visionLanguage = (process.env.DEFAULT_RESPONSE_LANGUAGE || "zh-CN").toLowerCase()
      const visionSystem = visionLanguage.startsWith("zh")
        ? [
            "你是图像理解助手。",
            "请仅输出严格的 JSON，不要包含额外文字。",
            "字段: captions(数组), ocr(字符串), insights(数组)。",
            "- captions: 每张图一句话概述（按顺序）。",
            "- ocr: 识别到的关键文字（合并为一段，可为空）。",
            "- insights: 3-6 条要点，描述图表/关系/异常。",
          ].join("\n")
        : [
            "You are a vision analysis assistant.",
            "Output strict JSON only, no extra text.",
            "Fields: captions(array), ocr(string), insights(array).",
            "- captions: one sentence per image (in order).",
            "- ocr: important recognized text (single paragraph, optional).",
            "- insights: 3–6 bullet points about charts/relations/anomalies.",
          ].join("\n")

      // Helper: inline or proxy a remote image so providers can always access it.
      const attemptInlineOrProxy = async (rawUrl: string, fallbackMime?: string) => {
        const finalUrl = rawUrl
        try {
          // file:// -> data URL
          if (typeof finalUrl === "string" && finalUrl.startsWith("file://")) {
            const filepath = finalUrl.replace(/^file:\/\//, "")
            const data = fs.readFileSync(filepath)
            const base64 = data.toString("base64")
            return `data:${fallbackMime || "application/octet-stream"};base64,${base64}`
          }
          // http(s) -> try inline; on failure, try proxy; if still failing, return proxy URL (non-inlined)
          if (typeof finalUrl === "string" && /^https?:\/\//i.test(finalUrl)) {
            const fetchOnce = async (u: string) => {
              const controller = new AbortController()
              const t = setTimeout(
                () => controller.abort(),
                Math.max(2000, toNumber(process.env.VISION_FETCH_TIMEOUT_MS) ?? 5000),
              )
              try {
                const res = await fetch(u, { signal: controller.signal })
                if (!res.ok) return null
                const ct = res.headers.get("content-type") || fallbackMime || "image/jpeg"
                const buf = new Uint8Array(await res.arrayBuffer())
                const maxBytes = toNumber(process.env.VISION_MAX_INLINE_BYTES) ?? 2000000
                if (ct.startsWith("image/") && buf.byteLength <= maxBytes) {
                  return `data:${ct};base64,${Buffer.from(buf).toString("base64")}`
                }
                return null
              } catch {
                return null
              } finally {
                clearTimeout(t)
              }
            }

            // Try inline directly
            const inlined = await fetchOnce(finalUrl)
            if (inlined) return inlined

            // Try via image proxy
            const proxyBase = (
              process.env.VISION_IMAGE_PROXY_URL || "https://webp.follow.is"
            ).replace(/\/$/, "")
            const proxied = `${proxyBase}?url=${encodeURIComponent(finalUrl)}`
            const inlinedViaProxy = await fetchOnce(proxied)
            if (inlinedViaProxy) return inlinedViaProxy
            // As a last resort, return proxied URL（不内联也至少可被部分模型拉取）
            return proxied
          }
        } catch (e) {
          console.warn("[ai-proxy] attemptInlineOrProxy error", (e as any)?.message || e)
        }
        return finalUrl
      }

      const visionParts: any[] = []
      for (const img of selectedImages) {
        const finalUrl = await attemptInlineOrProxy(img.url, img.mediaType)
        visionParts.push({
          type: "file",
          mediaType: img.mediaType,
          url: finalUrl,
          filename: img.filename,
        })
      }
      visionParts.push({
        type: "text",
        text: visionLanguage.startsWith("zh")
          ? "请分析这些图片并返回 JSON。"
          : "Analyze these images and return JSON only.",
      })

      // Create a dedicated call with the vision model
      const visionTimeoutMs = toNumber(process.env.VISION_TIMEOUT_MS) ?? 15000
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), Math.max(2000, visionTimeoutMs))
      let visionText = ""
      try {
        const visionResult = await generateText({
          model: createOpenAI({ apiKey: process.env.IFLOW_API_KEY!, baseURL: IFLOW_BASE_URL }).chat(
            visionModel,
          ),
          system: visionSystem,
          messages: convertToCoreMessages([{ role: "user", parts: visionParts }]),
          maxOutputTokens: 800,
          abortSignal: controller.signal,
          maxRetries: 0,
        })
        visionText = (visionResult?.text || "").trim()
      } catch (err: any) {
        const reason = controller.signal.aborted ? "timeout" : err?.message || String(err)
        console.warn("[ai-proxy] vision analysis failed", { reason })
      } finally {
        clearTimeout(timeout)
      }
      if (visionText) {
        const contextHeader = visionLanguage.startsWith("zh")
          ? "Context: Vision analysis (JSON)"
          : "Context: Vision analysis (JSON)"
        const contextText = `${contextHeader}\n${visionText}`.slice(0, 32000)

        // Inject into the first user message
        const firstUserIndex = normalizedUIMessages.findIndex((m: any) => m?.role === "user")
        if (firstUserIndex !== -1) {
          const target = normalizedUIMessages[firstUserIndex]
          target.parts = Array.isArray(target.parts) ? target.parts : []
          target.parts.unshift({ type: "text", text: contextText })
        } else {
          normalizedUIMessages.unshift({
            role: "user",
            parts: [{ type: "text", text: contextText }],
          })
        }
        console.info("[ai-proxy] injected vision analysis", {
          images: selectedImages.length,
          model: visionModel,
          textLength: contextText.length,
        })
      } else {
        // Prefer: vision -> text model (non-stream summary -> inject -> text model streaming)
        const preferToText = (() => {
          const n = (process.env.VISION_FALLBACK_TO_TEXT || "1").trim().toLowerCase()
          return !["0", "false", "no", "off"].includes(n)
        })()
        const allowVisionStream = (() => {
          const n = (process.env.VISION_FALLBACK_STREAM || "0").trim().toLowerCase()
          return !["0", "false", "no", "off"].includes(n)
        })()

        if (preferToText) {
          try {
            const promptParts: any[] = []
            for (const img of selectedImages) {
              const finalUrl = await attemptInlineOrProxy(img.url, img.mediaType)
              promptParts.push({
                type: "file",
                mediaType: img.mediaType,
                url: finalUrl,
                filename: img.filename,
              })
            }
            promptParts.push({
              type: "text",
              text: visionLanguage.startsWith("zh")
                ? "请根据这些图片给出简洁准确的文字描述与要点归纳。"
                : "Provide a concise and accurate description with key points for these images.",
            })

            const openaiV = createOpenAI({
              apiKey: process.env.IFLOW_API_KEY!,
              baseURL: IFLOW_BASE_URL,
            })
            const sum = await generateText({
              model: openaiV.chat(visionModel),
              system: visionSystem,
              messages: convertToCoreMessages([{ role: "user", parts: promptParts }]),
              maxOutputTokens: 800,
              maxRetries: 0,
            })
            const s = (sum?.text || "").trim()
            if (s) {
              const header = visionLanguage.startsWith("zh")
                ? "Context: Vision analysis (fallback)"
                : "Context: Vision analysis (fallback)"
              const textToInject = `${header}\n${s}`.slice(0, 32000)
              const idx = normalizedUIMessages.findIndex((m: any) => m?.role === "user")
              if (idx !== -1) {
                const t = normalizedUIMessages[idx]
                t.parts = Array.isArray(t.parts) ? t.parts : []
                t.parts.unshift({ type: "text", text: textToInject })
              } else {
                normalizedUIMessages.unshift({
                  role: "user",
                  parts: [{ type: "text", text: textToInject }],
                })
              }
              console.info("[ai-proxy] vision fallback -> text model", {
                images: selectedImages.length,
                model: visionModel,
              })
              // Do not return here — continue to text model below.
            } else if (allowVisionStream) {
              const openaiVision = createOpenAI({
                apiKey: process.env.IFLOW_API_KEY!,
                baseURL: IFLOW_BASE_URL,
              })
              const visionStream = streamText({
                model: openaiVision.chat(visionModel),
                messages: convertToCoreMessages(normalizedUIMessages),
              })
              console.info("[ai-proxy] vision fallback streaming", {
                images: selectedImages.length,
                model: visionModel,
              })
              return visionStream.toUIMessageStreamResponse({
                onError: (err) =>
                  typeof err === "string" ? err : (err as any)?.message || "Unknown error",
              })
            }
          } catch (e) {
            console.warn("[ai-proxy] vision fallback to text failed", (e as any)?.message || e)
            if (allowVisionStream) {
              const openaiVision = createOpenAI({
                apiKey: process.env.IFLOW_API_KEY!,
                baseURL: IFLOW_BASE_URL,
              })
              const visionStream = streamText({
                model: openaiVision.chat(visionModel),
                messages: convertToCoreMessages(normalizedUIMessages),
              })
              console.info("[ai-proxy] vision fallback streaming", {
                images: selectedImages.length,
                model: visionModel,
              })
              return visionStream.toUIMessageStreamResponse({
                onError: (err) =>
                  typeof err === "string" ? err : (err as any)?.message || "Unknown error",
              })
            }
          }
        } else if (allowVisionStream) {
          const openaiVision = createOpenAI({
            apiKey: process.env.IFLOW_API_KEY!,
            baseURL: IFLOW_BASE_URL,
          })
          const visionStream = streamText({
            model: openaiVision.chat(visionModel),
            messages: convertToCoreMessages(normalizedUIMessages),
          })
          console.info("[ai-proxy] vision fallback streaming", {
            images: selectedImages.length,
            model: visionModel,
          })
          return visionStream.toUIMessageStreamResponse({
            onError: (err) =>
              typeof err === "string" ? err : (err as any)?.message || "Unknown error",
          })
        }
      }
    }
  } catch (e) {
    console.warn("[ai-proxy] two-stage vision pipeline failed", e)
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

  const allowSamplingControls = !isReasoningModelId(modelId)
  const requestTemperature = toNumber(reqTemperature)
  const envTemperature = toNumber(process.env.DEFAULT_TEMPERATURE)
  const effectiveTemperature = allowSamplingControls
    ? (requestTemperature ?? envTemperature)
    : undefined

  const reasoningEffort =
    parseReasoningEffort((body?.reasoning as any)?.effort) ??
    parseReasoningEffort(body?.reasoningEffort) ??
    parseReasoningEffort(body?.model_reasoning_effort) ??
    parseReasoningEffort(process.env.DEFAULT_REASONING_EFFORT)

  const disableResponseStorage =
    parseBoolean(body?.disableResponseStorage) ??
    parseBoolean(body?.disable_response_storage) ??
    parseBoolean(process.env.DISABLE_RESPONSE_STORAGE)

  const openaiProviderOptions: Record<string, unknown> = {}
  if (reasoningEffort) {
    openaiProviderOptions.reasoningEffort = reasoningEffort
  }
  if (disableResponseStorage != null) {
    openaiProviderOptions.store = disableResponseStorage ? false : true
  }
  const finalProviderOptions =
    Object.keys(openaiProviderOptions).length > 0 ? { openai: openaiProviderOptions } : undefined

  const result = streamText({
    model: openai.chat(modelId),
    messages: convertToCoreMessages(normalizedUIMessages),
    ...(system ? { system } : {}),
    // Temperature precedence: request > env; ignored for reasoning models
    ...(effectiveTemperature != null ? { temperature: effectiveTemperature } : {}),
    // Allow larger outputs to reduce truncation in timeline summaries
    ...(finalMaxOutputTokens ? { maxOutputTokens: finalMaxOutputTokens } : {}),
    ...(finalProviderOptions ? { providerOptions: finalProviderOptions } : {}),
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
