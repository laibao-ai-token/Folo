// Eastmoney quote utilities for browser

const FIELDS = [
  "f57", // code
  "f58", // name
  "f43", // last price (cents)
  "f60", // prev close (cents)
  "f46", // open (cents)
  "f44", // high (cents)
  "f45", // low (cents)
  "f169", // change (cents)
  "f170", // change % (percentage value)
  "f47", // volume (hands)
  "f48", // amount (yuan)
  "f171", // amplitude % (percentage value)
  "f168", // turnover rate % (percentage value)
  "f86", // last update time (epoch seconds)
].join(",")

export function toSecId(input: string): string {
  const s = String(input).trim().toLowerCase()
  const m = s.match(/^(?:sh|sz)?(?<code>\d{6})$/)
  if (!m || !m.groups || !m.groups.code) throw new Error(`Unrecognized code: ${input}`)
  const { code } = m.groups
  // Heuristics for A-share market detection:
  // - Explicit prefix wins (sh* -> 1, sz* -> 0)
  // - Shanghai commonly uses prefixes 60*, 68* (STAR), and 5* (most ETFs/LOFs), 90* (B-shares)
  // - Others default to Shenzhen
  const hasShPrefix = s.startsWith("sh")
  const hasSzPrefix = s.startsWith("sz")
  const isShanghaiCode = /^(?:5|60|68|90)/.test(code)
  const market = hasShPrefix ? 1 : hasSzPrefix ? 0 : isShanghaiCode ? 1 : 0 // 1=SH, 0=SZ
  return `${market}.${code}`
}

const normFloat = (x: unknown) => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

export type Quote = {
  code: string
  name: string
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  change: number
  changePct: number // %
  volumeShares: number
  turnoverYuan: number
  amplitudePct: number // %
  turnoverRatePct: number // % 换手率
  timestampMs?: number // 最近更新时间（毫秒）
  limitUp?: number
  limitDown?: number
  sessionStatus?: "open" | "closed"
}

function normalizeQuote(data: Record<string, unknown>): Quote {
  const priceCents = normFloat(data.f43)
  const prevCloseCents = normFloat(data.f60)
  const openCents = normFloat(data.f46)
  const highCents = normFloat(data.f44)
  const lowCents = normFloat(data.f45)
  const chgCents = normFloat(data.f169)
  const chgPctPermil = normFloat(data.f170)
  const volHands = normFloat(data.f47)
  const amountYuan = normFloat(data.f48)
  const ampPctPermil = normFloat(data.f171)
  const turnoverRatePermil = normFloat((data as any).f168)
  const tsSec = Number((data as any).f86)

  const code = String((data as any).f57 ?? "")
  const name = String((data as any).f58 ?? "")
  const prevClose = prevCloseCents / 100

  const { limitUp, limitDown } = computeCnPriceLimit({ code, name, prevClose })
  const sessionStatus = getCnSessionStatus(tsSec ? new Date(tsSec * 1000) : new Date())

  return {
    code,
    name,
    price: priceCents / 100,
    prevClose,
    open: openCents / 100,
    high: highCents / 100,
    low: lowCents / 100,
    change: chgCents / 100,
    changePct: chgPctPermil / 100,
    volumeShares: volHands * 100,
    turnoverYuan: amountYuan,
    amplitudePct: ampPctPermil / 100,
    turnoverRatePct: turnoverRatePermil / 100,
    timestampMs: Number.isFinite(tsSec) ? tsSec * 1000 : undefined,
    limitUp,
    limitDown,
    sessionStatus,
  }
}

function computeCnPriceLimit({
  code,
  name,
  prevClose,
}: {
  code: string
  name: string
  prevClose: number
}) {
  if (!Number.isFinite(prevClose) || prevClose <= 0)
    return { limitUp: undefined as number | undefined, limitDown: undefined as number | undefined }
  const isST = /\bST\b|\*ST/i.test(name)
  const isChiNext = code.startsWith("300")
  const isStar = code.startsWith("688")
  const pct = isST ? 0.05 : isChiNext || isStar ? 0.2 : 0.1
  const step = 0.01
  const up = roundToStep(prevClose * (1 + pct), step)
  const down = roundToStep(prevClose * (1 - pct), step)
  return { limitUp: up, limitDown: down }
}

function roundToStep(v: number, step: number) {
  return Math.round(v / step) * step
}

function getCnSessionStatus(now: Date): "open" | "closed" {
  // China A-share regular trading hours: 09:30–11:30, 13:00–15:00 (UTC+8)
  const utc8 = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 8 * 3600000)
  const dow = utc8.getUTCDay() // 0=Sun..6=Sat
  if (dow === 0 || dow === 6) return "closed"
  const hm = utc8.getUTCHours() * 60 + utc8.getUTCMinutes()
  const open1 = 9 * 60 + 30
  const close1 = 11 * 60 + 30
  const open2 = 13 * 60
  const close2 = 15 * 60
  const open = (hm >= open1 && hm < close1) || (hm >= open2 && hm < close2)
  return open ? "open" : "closed"
}

export async function fetchQuoteByCode(code: string): Promise<Quote> {
  const secid = toSecId(code)
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(
    secid,
  )}&fields=${encodeURIComponent(FIELDS)}`

  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      Referer: "https://quote.eastmoney.com/",
    },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  if (!j || j.rc !== 0 || !j.data) throw new Error("Invalid payload")
  return normalizeQuote(j.data)
}

// --------------- K line (history) ---------------

export type KlineRow = {
  time: string
  open: number
  close: number
  high: number
  low: number
  volumeHands: number
  volumeShares: number
  turnoverYuan: number
  amplitudePct: number
}

export type KlinePayload = {
  code: string
  name: string
  market: number
  decimal: number
  preKPrice?: number
  klines: string[]
}

export type KlineResult = {
  meta: {
    code: string
    name: string
    market: number
    decimal: number
    preClose: number | null
  }
  rows: KlineRow[]
}

export type KlineOptions = {
  klt?: 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103 // minute / day / week / month
  lmt?: number // number of bars
  fqt?: 0 | 1 | 2 // adjust: none / forward / backward
}

export async function fetchKlineByCode(
  code: string,
  { klt = 101, lmt = 1300, fqt = 1 }: KlineOptions = {},
): Promise<KlineResult> {
  const secid = toSecId(code)
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(
    secid,
  )}&klt=${klt}&fqt=${fqt}&end=20500101&lmt=${lmt}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`

  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      Referer: "https://quote.eastmoney.com/",
    },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = (await r.json()) as { rc: number; data?: KlinePayload }
  if (!j || j.rc !== 0 || !j.data || !Array.isArray(j.data.klines)) {
    throw new Error("Invalid payload")
  }
  const meta = {
    code: j.data.code,
    name: j.data.name,
    market: j.data.market,
    decimal: j.data.decimal,
    preClose: typeof j.data.preKPrice === "number" ? j.data.preKPrice : null,
  }
  const rows: KlineRow[] = j.data.klines.map((line) => {
    const [time, open, close, high, low, volHands, amountYuan, amplitudePct] = line
      .split(",")
      .map((s, idx) => (idx === 0 ? s : Number(s))) as [
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    return {
      time,
      open,
      close,
      high,
      low,
      volumeHands: volHands,
      volumeShares: volHands * 100,
      turnoverYuan: amountYuan,
      amplitudePct,
    }
  })
  return { meta, rows }
}

/**
 * Compute 52-week (approx. last 260 trading days) high/low from daily K lines.
 * Falls back gracefully when data is insufficient.
 */
export function compute52WeekRange(
  rows: KlineRow[],
  window = 260,
): {
  high52?: number
  low52?: number
  highDate?: string
  lowDate?: string
} {
  if (!Array.isArray(rows) || rows.length === 0) return {}
  const n = Math.min(window, rows.length)
  let high = -Infinity
  let low = Infinity
  let highDate: string | undefined
  let lowDate: string | undefined
  for (let i = rows.length - n; i < rows.length; i++) {
    const r = rows[i]!
    if (typeof r.high === "number" && r.high > high) {
      high = r.high
      highDate = r.time
    }
    if (typeof r.low === "number" && r.low < low) {
      low = r.low
      lowDate = r.time
    }
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return {}
  return { high52: high, low52: low, highDate, lowDate }
}

// Minimal ECharts typings to avoid adding deps
export type EChartsInstance = {
  setOption: (opt: unknown) => void
  resize: () => void
  dispose: () => void
}
export type EChartsModule = {
  init: (dom: HTMLDivElement) => EChartsInstance
  getInstanceByDom?: (dom: HTMLDivElement) => EChartsInstance | undefined
}

declare global {
  interface Window {
    echarts?: EChartsModule
    __echartsLoader?: Promise<EChartsModule>
  }
}

export async function ensureEcharts(): Promise<EChartsModule> {
  if (window.echarts) return window.echarts
  if (window.__echartsLoader) return window.__echartsLoader
  window.__echartsLoader = new Promise<EChartsModule>((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"
    s.async = true
    s.onload = () =>
      window.echarts ? resolve(window.echarts) : reject(new Error("echarts not available"))
    s.onerror = () => reject(new Error("failed to load echarts"))
    document.head.append(s)
  })
  return window.__echartsLoader
}

// --------- Technicals (moving averages & deviation) ---------

/** Compute last SMA value for the provided window using close prices. */
export function smaLast(rows: Pick<KlineRow, "close">[], win: number): number | undefined {
  if (!Array.isArray(rows) || rows.length < win) return undefined
  let sum = 0
  for (let i = rows.length - win; i < rows.length; i++) sum += rows[i]!.close
  const v = sum / win
  return Number.isFinite(v) ? +v.toFixed(2) : undefined
}

export function computeMASummary(rows: KlineRow[]): {
  ma5?: number
  ma10?: number
  ma20?: number
  ma60?: number
} {
  return {
    ma5: smaLast(rows, 5),
    ma10: smaLast(rows, 10),
    ma20: smaLast(rows, 20),
    ma60: smaLast(rows, 60),
  }
}

function percentile(arr: number[], p: number): number | undefined {
  const a = arr
    .filter((x) => Number.isFinite(x))
    .slice()
    .sort((x, y) => x - y)
  if (a.length === 0) return undefined
  const rank = (p / 100) * (a.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return a[lo]
  const v = a[lo]! + (a[hi]! - a[lo]!) * (rank - lo)
  return v
}

/**
 * From daily closes compute absolute deviation distribution for MA20/MA60
 * and return P75/P90 thresholds for adaptive highlighting.
 */
export function computeDeviationThresholds(rows: KlineRow[]): {
  dev20: { p75?: number; p90?: number }
  dev60: { p75?: number; p90?: number }
} {
  const n = rows.length
  const out = {
    dev20: {} as { p75?: number; p90?: number },
    dev60: {} as { p75?: number; p90?: number },
  }
  if (n < 60) return out
  // Build MA arrays
  const closes = rows.map((r) => r.close)
  const ma20: (number | undefined)[] = Array.from({ length: n })
  const ma60: (number | undefined)[] = Array.from({ length: n })
  let sum20 = 0
  let sum60 = 0
  for (let i = 0; i < n; i++) {
    const c = closes[i]!
    sum20 += c
    sum60 += c
    if (i >= 20) sum20 -= closes[i - 20]!
    if (i >= 60) sum60 -= closes[i - 60]!
    if (i >= 19) ma20[i] = sum20 / 20
    if (i >= 59) ma60[i] = sum60 / 60
  }
  const dev20Abs: number[] = []
  const dev60Abs: number[] = []
  for (let i = 0; i < n; i++) {
    const c = closes[i]!
    const m20 = ma20[i]
    const m60 = ma60[i]
    if (typeof m20 === "number" && m20 !== 0) dev20Abs.push(Math.abs((c - m20) / m20) * 100)
    if (typeof m60 === "number" && m60 !== 0) dev60Abs.push(Math.abs((c - m60) / m60) * 100)
  }
  out.dev20.p75 = percentile(dev20Abs, 75)
  out.dev20.p90 = percentile(dev20Abs, 90)
  out.dev60.p75 = percentile(dev60Abs, 75)
  out.dev60.p90 = percentile(dev60Abs, 90)
  return out
}

// --------- Volume stats ---------

export function computeAvgVolumes(
  rows: Pick<KlineRow, "volumeShares">[],
  windows: number[] = [5, 10, 20],
): Record<`avgVol${number}`, number | undefined> {
  const out: Record<string, number | undefined> = {}
  for (const w of windows) {
    if (!Array.isArray(rows) || rows.length < w) {
      out[`avgVol${w}`] = undefined
      continue
    }
    let sum = 0
    for (let i = rows.length - w; i < rows.length; i++) sum += rows[i]!.volumeShares
    out[`avgVol${w}`] = Math.round(sum / w)
  }
  return out as Record<`avgVol${number}`, number | undefined>
}

export function judgeVolumeStatus(
  volRatio: number | undefined,
): "very-high" | "high" | "normal" | "low" | "very-low" | undefined {
  if (typeof volRatio !== "number" || !Number.isFinite(volRatio)) return undefined
  if (volRatio >= 2) return "very-high"
  if (volRatio >= 1.5) return "high"
  if (volRatio >= 0.8) return "normal"
  if (volRatio >= 0.5) return "low"
  return "very-low"
}
