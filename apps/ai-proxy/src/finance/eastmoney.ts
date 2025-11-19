const EASTMONEY_BASE = "https://push2.eastmoney.com/api/qt/stock/get"
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Referer: "https://quote.eastmoney.com/",
}

const US_FIELDS = "f57,f58,f43,f60,f46,f44,f45,f169,f170,f47,f86"
const CN_FIELDS = [
  "f57",
  "f58",
  "f43",
  "f60",
  "f46",
  "f44",
  "f45",
  "f169",
  "f170",
  "f47",
  "f48",
  "f171",
  "f168",
  "f86",
].join(",")

const normFloat = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export type UsQuote = {
  symbol: string
  name: string
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  change: number
  changePct: number
  volumeShares?: number
  timestampMs?: number
}

export async function fetchEastmoneyUsQuote(symbolInput: string): Promise<UsQuote> {
  const symbol = symbolInput.trim().toUpperCase()
  if (!symbol) throw new Error("symbol is required")

  const url = `${EASTMONEY_BASE}?secid=${encodeURIComponent(`105.${symbol}`)}&fields=${encodeURIComponent(US_FIELDS)}`
  const res = await fetch(url, { headers: COMMON_HEADERS })
  if (!res.ok) throw new Error(`Eastmoney HTTP ${res.status}`)
  const payload = (await res.json()) as { rc: number; data?: Record<string, unknown> }
  if (!payload || payload.rc !== 0 || !payload.data) throw new Error("Eastmoney payload error")

  const priceMilli = normFloat(payload.data.f43)
  const prevCloseMilli = normFloat(payload.data.f60)
  const openMilli = normFloat(payload.data.f46)
  const highMilli = normFloat(payload.data.f44)
  const lowMilli = normFloat(payload.data.f45)
  const chgMilli = normFloat(payload.data.f169)
  const chgPctPermil = normFloat(payload.data.f170)
  const tsSec = Number(payload.data.f86)

  return {
    symbol: String(payload.data.f57 ?? symbol),
    name: String(payload.data.f58 ?? symbol),
    price: priceMilli / 1000,
    prevClose: prevCloseMilli / 1000,
    open: openMilli / 1000,
    high: highMilli / 1000,
    low: lowMilli / 1000,
    change: chgMilli / 1000,
    changePct: chgPctPermil / 100,
    volumeShares: Number.isFinite(payload.data.f47) ? Number(payload.data.f47) : undefined,
    timestampMs: Number.isFinite(tsSec) ? tsSec * 1000 : undefined,
  }
}

export type CnQuote = {
  code: string
  name: string
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  change: number
  changePct: number
  volumeShares: number
  turnoverYuan: number
  amplitudePct: number
  turnoverRatePct: number
  timestampMs?: number
  limitUp?: number
  limitDown?: number
  sessionStatus?: "open" | "closed"
}

const toSecId = (input: string): string => {
  const trimmed = String(input).trim().toLowerCase()
  const match = trimmed.match(/^(?:sh|sz)?(?<code>\d{6})$/)
  if (!match?.groups?.code) throw new Error(`Unrecognized code: ${input}`)
  const { code } = match.groups
  const hasShPrefix = trimmed.startsWith("sh")
  const hasSzPrefix = trimmed.startsWith("sz")
  const isShanghaiCode = /^(?:5|60|68|90)/.test(code)
  const market = hasShPrefix ? 1 : hasSzPrefix ? 0 : isShanghaiCode ? 1 : 0
  return `${market}.${code}`
}

const computeCnPriceLimit = ({
  code,
  name,
  prevClose,
}: {
  code: string
  name: string
  prevClose: number
}): { limitUp?: number; limitDown?: number } => {
  if (!Number.isFinite(prevClose) || prevClose <= 0) return {}
  const isST = /\bST\b|\*ST/i.test(name)
  const isChiNext = code.startsWith("300")
  const isStar = code.startsWith("688")
  const pct = isST ? 0.05 : isChiNext || isStar ? 0.2 : 0.1
  const step = 0.01
  const roundToStep = (value: number) => Math.round(value / step) * step
  return {
    limitUp: roundToStep(prevClose * (1 + pct)),
    limitDown: roundToStep(prevClose * (1 - pct)),
  }
}

const getCnSessionStatus = (now: Date): "open" | "closed" => {
  const utc8 = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 8 * 3600000)
  const dow = utc8.getUTCDay()
  if (dow === 0 || dow === 6) return "closed"
  const hm = utc8.getUTCHours() * 60 + utc8.getUTCMinutes()
  const open1 = 9 * 60 + 30
  const close1 = 11 * 60 + 30
  const open2 = 13 * 60
  const close2 = 15 * 60
  const open = (hm >= open1 && hm < close1) || (hm >= open2 && hm < close2)
  return open ? "open" : "closed"
}

export async function fetchEastmoneyCnQuote(codeInput: string): Promise<CnQuote> {
  const secid = toSecId(codeInput)
  const url = `${EASTMONEY_BASE}?secid=${encodeURIComponent(secid)}&fields=${encodeURIComponent(
    CN_FIELDS,
  )}`
  const res = await fetch(url, { headers: COMMON_HEADERS })
  if (!res.ok) throw new Error(`Eastmoney HTTP ${res.status}`)
  const payload = (await res.json()) as { rc: number; data?: Record<string, unknown> }
  if (!payload || payload.rc !== 0 || !payload.data) throw new Error("Eastmoney payload error")

  const priceCents = normFloat(payload.data.f43)
  const prevCloseCents = normFloat(payload.data.f60)
  const openCents = normFloat(payload.data.f46)
  const highCents = normFloat(payload.data.f44)
  const lowCents = normFloat(payload.data.f45)
  const chgCents = normFloat(payload.data.f169)
  const chgPctPermil = normFloat(payload.data.f170)
  const volHands = normFloat(payload.data.f47)
  const amountYuan = normFloat(payload.data.f48)
  const ampPctPermil = normFloat(payload.data.f171)
  const turnoverRatePermil = normFloat(payload.data.f168)
  const tsSec = Number(payload.data.f86)

  const code = String(payload.data.f57 ?? "")
  const name = String(payload.data.f58 ?? "")
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

// ---------------- US Kline via Yahoo (server side) ----------------

export type UsKlineRow = {
  time: string
  open: number
  close: number
  high: number
  low: number
  volumeShares: number
}

export type UsKlineResult = { meta: { symbol: string; currency?: string }; rows: UsKlineRow[] }

export async function fetchUsKlineViaYahooServer(
  symbolInput: string,
  {
    range = "5y",
    interval = "1d",
  }: { range?: string; interval?: "1m" | "5m" | "1d" | "1wk" | "1mo" } = {},
): Promise<UsKlineResult> {
  const symbol = symbolInput.trim().toUpperCase()
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=${range}&interval=${interval}`
  async function load(url: string): Promise<any> {
    const r = await fetch(url, { cache: "no-store" })
    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`)
    const text = await r.text()
    // Some mirrors return annotated text; try to parse JSON block
    try {
      return JSON.parse(text)
    } catch {
      // crude extract of JSON object when wrapped by r.jina.ai
      const idx = text.indexOf('{"chart"')
      if (idx !== -1) {
        const slice = text.slice(idx)
        return JSON.parse(slice)
      }
      throw new Error("Yahoo JSON parse error")
    }
  }

  try {
    let j: any
    try {
      j = await load(base)
    } catch {
      const mirrored = `https://r.jina.ai/http://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol,
      )}?range=${range}&interval=${interval}`
      j = await load(mirrored)
    }
    const res = j?.chart?.result?.[0]
    if (!res) throw new Error("Yahoo payload error")
    const ts: number[] = res.timestamp || []
    const q = res.indicators?.quote?.[0] || {}
    const opens: number[] = q.open || []
    const closes: number[] = q.close || []
    const highs: number[] = q.high || []
    const lows: number[] = q.low || []
    const vols: number[] = q.volume || []
    const rows: UsKlineRow[] = ts.map((t, i) => ({
      time:
        interval === "1d" || interval === "1wk" || interval === "1mo"
          ? new Date(t * 1000).toISOString().slice(0, 10)
          : new Date(t * 1000).toISOString(),
      open: Number(opens[i] ?? Number.NaN),
      close: Number(closes[i] ?? Number.NaN),
      high: Number(highs[i] ?? Number.NaN),
      low: Number(lows[i] ?? Number.NaN),
      volumeShares: Number(vols[i] ?? 0),
    }))
    return { meta: { symbol, currency: res.meta?.currency }, rows }
  } catch {
    // Fallback to Stooq CSV via mirror; daily/weekly/monthly only
    const i = interval === "1wk" ? "w" : interval === "1mo" ? "m" : "d"
    const s = `${symbol.toLowerCase()}.us`
    const url = `https://r.jina.ai/http://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=${i}`
    const text = await (await fetch(url, { cache: "no-store" })).text()
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^Title:|^URL Source:|^Markdown Content:$/i.test(l))
    const csvIdx = lines.findIndex((l) => /^Date,Open,High,Low,Close,Volume/i.test(l))
    const data = (csvIdx !== -1 ? lines.slice(csvIdx + 1) : lines).filter((l) =>
      /\d{4}-\d{2}-\d{2}/.test(l),
    )
    const rows: UsKlineRow[] = data.map((line) => {
      const [date, open, high, low, close, vol] = line.split(",")
      return {
        time: date,
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volumeShares: Number(vol || 0),
      }
    })
    if (rows.length === 0) throw new Error("Yahoo/Stooq both failed")
    return { meta: { symbol, currency: undefined }, rows }
  }
}
