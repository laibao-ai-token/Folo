import { useEffect, useMemo, useRef, useState } from "react"

import type { EChartsInstance } from "./eastmoney"
import { ensureEcharts, fetchKlineByCode } from "./eastmoney"

export type Timeframe = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX"

export function AsharesLineChart({
  code,
  timeframe = "1M",
  height = 220,
}: {
  code: string
  timeframe?: Timeframe
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
        const [echarts, data] = await Promise.all([ensureEcharts(), fetchKlineByCode(code, req)])
        if (disposed) return
        const el = containerRef.current!
        chart = echarts.getInstanceByDom?.(el) || echarts.init(el)

        // Build series from closes
        const { rows } = data
        const x = rows.map((r) => r.time)
        const closes = rows.map((r) => r.close)
        const prevClose =
          data.meta.preClose && data.meta.preClose > 0
            ? data.meta.preClose
            : closes.length > 0
              ? closes[0]!
              : 0

        const option = buildLineOption({ x, closes, prevClose })
        chart.setOption(option, true)
        setStatus(`${data.meta.name} · ${rows.length} pts`)
      } catch (e: any) {
        setError(e?.message || String(e))
        setStatus("")
      }
    }
    if (code) run()
    else setStatus("")
    const onResize = () => chart?.resize()
    window.addEventListener("resize", onResize)
    return () => {
      disposed = true
      window.removeEventListener("resize", onResize)
      chart?.dispose()
    }
  }, [code, req])

  return (
    <div className="mt-0 w-full">
      <div className="text-text-tertiary mb-0 text-xs">{status}</div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      <div ref={containerRef} style={{ height, width: "100%" }} />
    </div>
  )
}

function resolveRequest(tf: Timeframe): {
  klt: 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103
  lmt: number
  fqt: 0 | 1 | 2
} {
  switch (tf) {
    case "1D": {
      return { klt: 1, lmt: 260, fqt: 1 }
    }
    case "5D": {
      return { klt: 5, lmt: 240, fqt: 1 }
    }
    case "1M": {
      return { klt: 101, lmt: 30, fqt: 1 }
    }
    case "6M": {
      return { klt: 101, lmt: 180, fqt: 1 }
    }
    case "YTD": {
      const start = new Date(new Date().getFullYear(), 0, 1)
      const now = new Date()
      const days = Math.max(30, Math.ceil((now.getTime() - start.getTime()) / (24 * 3600 * 1000)))
      return { klt: 101, lmt: Math.min(400, days), fqt: 1 }
    }
    case "1Y": {
      return { klt: 101, lmt: 260, fqt: 1 }
    }
    case "5Y": {
      return { klt: 101, lmt: 1300, fqt: 1 }
    }
    case "MAX": {
      return { klt: 101, lmt: 2000, fqt: 1 }
    }
  }
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
        smooth: false,
        symbol: "none",
        lineStyle: { width: 1, color: "#9ca3af", type: "dashed" },
        tooltip: { show: false },
      },
    ],
  }
}
