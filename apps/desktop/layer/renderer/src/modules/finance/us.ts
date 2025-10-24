// US stocks via Eastmoney (quote) + Yahoo (kline)

export { ensureEcharts } from "./eastmoney"

const normFloat = (x: unknown) => {
  const n = Number(x)
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
  changePct: number // %
  volumeShares?: number
  // Last update time from Eastmoney payload (seconds since epoch -> ms)
  timestampMs?: number
}

// Eastmoney quote for US stocks uses secid=105.SYMBOL
// Price-related fields appear to use 1/1000 scaling (e.g., 247335 -> $247.335)
// f170 is percentage value; divide by 100 to get %.
export async function fetchUsQuoteBySymbol(symbolInput: string): Promise<UsQuote> {
  const symbol = symbolInput.trim().toUpperCase()
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(
    `105.${symbol}`,
  )}&fields=${encodeURIComponent("f57,f58,f43,f60,f46,f44,f45,f169,f170,f47,f86")}`
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      Referer: "https://quote.eastmoney.com/",
    },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = (await r.json()) as { rc: number; data?: any }
  if (!j || j.rc !== 0 || !j.data) throw new Error("Invalid payload")

  const priceMilli = normFloat(j.data.f43)
  const prevCloseMilli = normFloat(j.data.f60)
  const openMilli = normFloat(j.data.f46)
  const highMilli = normFloat(j.data.f44)
  const lowMilli = normFloat(j.data.f45)
  const chgMilli = normFloat(j.data.f169)
  const chgPctPermil = normFloat(j.data.f170)
  const tsSec = Number(j.data.f86)

  return {
    symbol: String(j.data.f57 ?? symbol),
    name: String(j.data.f58 ?? symbol),
    price: priceMilli / 1000,
    prevClose: prevCloseMilli / 1000,
    open: openMilli / 1000,
    high: highMilli / 1000,
    low: lowMilli / 1000,
    change: chgMilli / 1000,
    changePct: chgPctPermil / 100,
    volumeShares: Number.isFinite(j.data.f47) ? Number(j.data.f47) : undefined,
    timestampMs: Number.isFinite(tsSec) ? tsSec * 1000 : undefined,
  }
}

// Yahoo chart (delayed). May be rate-limited; use judiciously.
export type UsKlineRow = {
  time: string // ISO or YYYY-MM-DD HH:mm
  open: number
  close: number
  high: number
  low: number
  volumeShares: number
}

export type UsKlineResult = { meta: { symbol: string; currency?: string }; rows: UsKlineRow[] }

export type UsKlineOptions = {
  range?: "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "10y" | "ytd" | "max"
  interval?: "1m" | "5m" | "1d" | "1wk" | "1mo"
}

export async function fetchUsKlineViaYahoo(
  symbolInput: string,
  { range = "5y", interval = "1d" }: UsKlineOptions = {},
): Promise<UsKlineResult> {
  const symbol = symbolInput.trim().toUpperCase()
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  // Helper to read JSON from either Yahoo or mirror (as text first)
  async function load(url: string): Promise<any> {
    const r = await fetch(url, { cache: "no-store" })
    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`)
    const text = await r.text()
    return JSON.parse(text)
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
    let rows: UsKlineRow[] = []
    for (const [i, t_] of ts.entries()) {
      const t = t_! * 1000
      const dt = new Date(t)
      const iso =
        interval === "1d" || interval === "1wk" || interval === "1mo"
          ? dt.toISOString().slice(0, 10)
          : dt.toISOString()
      rows.push({
        time: iso,
        open: Number(opens[i] ?? Number.NaN),
        close: Number(closes[i] ?? Number.NaN),
        high: Number(highs[i] ?? Number.NaN),
        low: Number(lows[i] ?? Number.NaN),
        volumeShares: Number(vols[i] ?? 0),
      })
    }
    // If asking for 1-minute data but Yahoo only returns a handful of points,
    // try broadening the range to 5d for more reliable minutes.
    if (interval === "1m" && rows.length < 50) {
      const alt = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1m`
      let j2: any
      try {
        j2 = await load(alt)
      } catch {
        const mirroredAlt = `https://r.jina.ai/http://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1m`
        j2 = await load(mirroredAlt)
      }
      const r2 = j2?.chart?.result?.[0]
      const ts2: number[] = r2?.timestamp || []
      const q2 = r2?.indicators?.quote?.[0] || {}
      const rows2: UsKlineRow[] = []
      for (const [i, t_] of ts2.entries()) {
        const t = t_! * 1000
        const dt = new Date(t)
        const iso = dt.toISOString()
        rows2.push({
          time: iso,
          open: Number((q2.open || [])[i] ?? Number.NaN),
          close: Number((q2.close || [])[i] ?? Number.NaN),
          high: Number((q2.high || [])[i] ?? Number.NaN),
          low: Number((q2.low || [])[i] ?? Number.NaN),
          volumeShares: Number((q2.volume || [])[i] ?? 0),
        })
      }
      if (rows2.length > rows.length) rows = rows2
    }
    return { meta: { symbol, currency: res.meta?.currency }, rows }
  } catch {
    // Yahoo unavailable or blocked — fallback to Stooq CSV via mirror（仅支持日/周/月）。
    const i = interval === "1wk" ? "w" : interval === "1mo" ? "m" : "d"
    const s = `${symbol.toLowerCase()}.us`
    const url = `https://r.jina.ai/http://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=${i}`
    const text = await (await fetch(url, { cache: "no-store" })).text()
    // r.jina.ai wraps some responses; strip the preface if present
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^Title:|^URL Source:|^Markdown Content:$/i.test(l))
    const csvIdx = lines.findIndex((l) => /^Date,Open,High,Low,Close,Volume/i.test(l))
    const data = (csvIdx !== -1 ? lines.slice(csvIdx + 1) : lines).filter((l) =>
      /\d{4}-\d{2}-\d{2}/.test(l),
    )
    const rows: UsKlineRow[] = []
    for (const line of data) {
      const [date, open, high, low, close, vol] = line.split(",")
      if (!date || !open || !close) continue
      rows.push({
        time: date,
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volumeShares: Number(vol || 0),
      })
    }
    if (rows.length === 0) throw new Error("Yahoo/Stooq both failed")

    // Stooq returns full history. Trim rows according to requested range so
    // short horizons like 1D/5D don't render decades of data.
    function parseDate(d: string): number {
      // Stooq uses YYYY-MM-DD; treat as UTC midnight.
      return Date.parse(`${d}T00:00:00Z`)
    }
    function startByRange(endTs: number): number | null {
      const end = new Date(endTs)
      const y = end.getUTCFullYear()
      const m = end.getUTCMonth()
      const d = end.getUTCDate()
      const make = (yy: number, mm: number, dd: number) => Date.UTC(yy, mm, dd)
      switch (range) {
        case "1d": {
          return endTs - 1 * 24 * 3600 * 1000
        }
        case "5d": {
          return endTs - 7 * 24 * 3600 * 1000
        } // ~5 trading days
        case "1mo": {
          return make(y, m - 1, d)
        }
        case "3mo": {
          return make(y, m - 3, d)
        }
        case "6mo": {
          return make(y, m - 6, d)
        }
        case "1y": {
          return make(y - 1, m, d)
        }
        case "2y": {
          return make(y - 2, m, d)
        }
        case "5y": {
          return make(y - 5, m, d)
        }
        case "10y": {
          return make(y - 10, m, d)
        }
        case "ytd": {
          return Date.UTC(y, 0, 1)
        }
        default: {
          return null
        }
      }
    }

    const endTs = parseDate(rows.at(-1)!.time)
    const startTs = startByRange(endTs)
    const trimmed = startTs == null ? rows : rows.filter((r) => parseDate(r.time) >= startTs)

    return { meta: { symbol, currency: undefined }, rows: trimmed }
  }
}
