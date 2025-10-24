import { useEffect, useMemo, useRef, useState } from "react"

import type { EChartsInstance } from "./eastmoney"
import { ensureEcharts } from "./eastmoney"
import { fetchUsKlineViaYahoo } from "./us"

export type UsTimeframe = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX"

export function UsLineChart({
  symbol,
  timeframe = "1M",
  height = 220,
}: {
  symbol: string
  timeframe?: UsTimeframe
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<string>("")
  const [error, setError] = useState<string>("")

  const req = useMemo(() => resolveRequest(timeframe), [timeframe])

  useEffect(() => {
    let chart: EChartsInstance | null = null
    let disposed = false
    async function run() {
      setError("")
      setStatus("Loading…")
      try {
        const data = await fetchUsKlineViaYahoo(symbol, req)
        if (disposed) return
        const { rows } = data
        // Apply slicing for 1D/5D when Yahoo returns daily intervals
        const sliced = sliceByTimeframe(rows, timeframe)
        const x = sliced.map((r) => r.time)
        const closes = sliced.map((r) => r.close)
        const prevClose = closes.length > 1 ? closes[0]! : closes.at(-1) || 0

        const el = containerRef.current!
        const echarts = await ensureEcharts()
        chart = (echarts.getInstanceByDom?.(el) as EChartsInstance | undefined) || echarts.init(el)
        chart.setOption(buildLineOption({ x, closes, prevClose }), true)
        setStatus(`${symbol.toUpperCase()} · ${sliced.length} pts`)
      } catch (e: any) {
        setError(e?.message || String(e))
        setStatus("")
      }
    }
    if (symbol) run()
    const onResize = () => chart?.resize()
    window.addEventListener("resize", onResize)
    return () => {
      disposed = true
      window.removeEventListener("resize", onResize)
      chart?.dispose()
    }
  }, [symbol, req, timeframe])

  return (
    <div className="mt-0 w-full">
      <div className="text-text-tertiary mb-0 text-xs">{status}</div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      <div ref={containerRef} style={{ height, width: "100%" }} />
    </div>
  )
}

function resolveRequest(tf: UsTimeframe): {
  range: "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "10y" | "ytd" | "max"
  interval: "1m" | "5m" | "1d" | "1wk" | "1mo"
} {
  switch (tf) {
    case "1D": {
      return { range: "1d", interval: "1m" }
    }
    case "5D": {
      return { range: "5d", interval: "5m" }
    }
    case "1M": {
      return { range: "3mo", interval: "1d" }
    }
    case "6M": {
      return { range: "6mo", interval: "1d" }
    }
    case "YTD": {
      return { range: "ytd", interval: "1d" }
    }
    case "1Y": {
      return { range: "1y", interval: "1d" }
    }
    case "5Y": {
      return { range: "5y", interval: "1wk" }
    }
    case "MAX": {
      return { range: "max", interval: "1mo" }
    }
  }
}

function sliceByTimeframe<T extends { time: string }>(rows: T[], tf: UsTimeframe): T[] {
  if (!rows || rows.length === 0) return rows
  const isIntraday = rows[0]!.time.includes("T") // Yahoo intraday uses ISO timestamps
  if (isIntraday) {
    // For intraday rows (1m/5m). If 1D, keep only the latest trading day.
    if (tf === "1D") {
      const last = rows.at(-1)!
      const lastDate = last.time.slice(0, 10)
      return rows.filter((r) => r.time.slice(0, 10) === lastDate)
    }
    return rows
  }
  // Daily-level data (e.g., Stooq fallback or Yahoo daily). Manually slice by timeframe.
  const parse = (d: string) => Date.parse(`${d}T00:00:00Z`)
  const end = parse(rows.at(-1)!.time)
  const startFor = (tf: UsTimeframe): number | null => {
    const dt = new Date(end)
    const y = dt.getUTCFullYear()
    const m = dt.getUTCMonth()
    const dd = dt.getUTCDate()
    const make = (yy: number, mm: number, d: number) => Date.UTC(yy, mm, d)
    switch (tf) {
      case "1D": {
        // Degrade to recent 10 trading days when minute data is unavailable
        return end - 14 * 24 * 3600 * 1000
      }
      case "5D": {
        // Degrade to recent ~1 month of daily bars
        return end - 35 * 24 * 3600 * 1000
      }
      case "1M": {
        return make(y, m - 1, dd)
      }
      case "6M": {
        return make(y, m - 6, dd)
      }
      case "YTD": {
        return Date.UTC(y, 0, 1)
      }
      case "1Y": {
        return make(y - 1, m, dd)
      }
      case "5Y": {
        return make(y - 5, m, dd)
      }
      default: {
        return null
      }
    }
  }
  const start = startFor(tf)
  return start == null ? rows : rows.filter((r) => parse(r.time) >= start)
}

function buildLineOption({
  x,
  closes,
  prevClose,
}: {
  x: string[]
  closes: number[]
  prevClose: number
}) {
  return {
    grid: { left: 8, right: 8, top: 4, bottom: 36, containLabel: true },
    xAxis: {
      type: "category",
      data: x,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#444" } },
      axisLabel: { color: "#9ca3af" },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitLine: { lineStyle: { color: "#333", type: "dashed" } },
      axisLabel: { color: "#9ca3af" },
    },
    tooltip: { trigger: "axis" },
    series: [
      {
        name: "Close",
        type: "line",
        data: closes,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#22d3ee" },
        areaStyle: { color: "rgba(34,211,238,0.12)" },
      },
      {
        name: "PrevClose",
        type: "line",
        data: Array.from({ length: closes.length }, () => prevClose),
        symbol: "none",
        lineStyle: { width: 1, color: "#9ca3af", type: "dashed" },
        tooltip: { show: false },
      },
    ],
  }
}
