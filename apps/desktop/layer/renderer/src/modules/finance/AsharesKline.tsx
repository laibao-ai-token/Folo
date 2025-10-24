import { useEffect, useMemo, useRef, useState } from "react"

import type { EChartsInstance } from "./eastmoney"
import { ensureEcharts, fetchKlineByCode } from "./eastmoney"

type Props = {
  code: string
  years?: number
  klt?: 1 | 5 | 15 | 30 | 60 | 101 | 102 | 103
  fqt?: 0 | 1 | 2
  height?: number | string
}

export function AsharesKline({ code, years = 5, klt = 101, fqt = 1, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<string>("")
  const [error, setError] = useState<string>("")

  const lmt = useMemo(() => {
    // Rough bar count by years
    return klt >= 101 ? years * 260 : years * 260 * 4
  }, [years, klt])

  useEffect(() => {
    let chart: EChartsInstance | null = null
    let disposed = false
    async function run() {
      setError("")
      setStatus("Loading…")
      try {
        const [echarts, data] = await Promise.all([
          ensureEcharts(),
          fetchKlineByCode(code, { klt, lmt, fqt }),
        ])
        if (disposed) return
        const el = containerRef.current!
        chart = echarts.getInstanceByDom?.(el) || echarts.init(el)
        chart.setOption(buildOption(data))
        setStatus(`${data.meta.name} · ${data.rows.length} bars`)
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
  }, [code, klt, lmt, fqt])

  return (
    <div className="mt-4 w-full">
      <div className="text-text-tertiary mb-1 text-xs">{status}</div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      <div ref={containerRef} style={{ height, width: "100%" }} />
    </div>
  )
}

function buildOption(payload: { meta: { code: string; name: string }; rows: any[] }) {
  const { code } = payload.meta
  const { name } = payload.meta
  const category: string[] = []
  const values: [number, number, number, number][] = [] // [open, close, low, high]
  const volumes: number[] = []
  for (const r of payload.rows) {
    category.push(r.time)
    values.push([r.open, r.close, r.low, r.high])
    volumes.push(r.volumeShares)
  }
  const closes = values.map((v) => v[1])
  const ma = (w: number) => movingAverage(closes, w)
  // ---- BOLL (n=20, k=2) ----
  const BOLL_N = 20
  const BOLL_K = 2
  const { bollMid, bollUp, bollLow } = computeBOLL(closes, BOLL_N, BOLL_K)

  // ---- MACD (12,26,9) ----
  const { dif, dea, hist } = computeMACD(closes, 12, 26, 9)

  return {
    backgroundColor: "transparent",
    animation: false,
    title: {
      text: `${name} (${code})`,
      left: 8,
      top: 0,
      textStyle: { fontSize: 12, color: "#9ca3af" },
    },
    grid: [
      { left: 8, right: 8, top: 18, height: "56%" }, // Main K
      { left: 8, right: 8, top: "74%", height: "12%" }, // Volume
      { left: 8, right: 8, top: "88%", height: "10%" }, // MACD
    ],
    tooltip: { trigger: "axis" },
    axisPointer: { link: [{ xAxisIndex: [0, 1, 2] }] },
    xAxis: [
      {
        type: "category",
        data: category,
        boundaryGap: true,
        axisLine: { onZero: false },
        min: "dataMin",
        max: "dataMax",
      },
      {
        type: "category",
        data: category,
        gridIndex: 1,
        boundaryGap: true,
        axisLine: { onZero: false },
        min: "dataMin",
        max: "dataMax",
      },
      {
        type: "category",
        data: category,
        gridIndex: 2,
        boundaryGap: true,
        axisLine: { onZero: false },
        min: "dataMin",
        max: "dataMax",
      },
    ],
    yAxis: [{ scale: true }, { gridIndex: 1, scale: true }, { gridIndex: 2, scale: true }],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1, 2], start: 60, end: 100 },
      { type: "slider", xAxisIndex: [0, 1], top: 0, height: 14, start: 60, end: 100 },
    ],
    series: [
      {
        name: "K",
        type: "candlestick",
        data: values,
        itemStyle: {
          color: "#ef5350",
          color0: "#26a69a",
          borderColor: "#ef5350",
          borderColor0: "#26a69a",
        },
      },
      // BOLL bands on main grid
      {
        name: "BOLL-UP",
        type: "line",
        data: bollUp,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1, color: "#eab308" },
      },
      {
        name: "BOLL-MID",
        type: "line",
        data: bollMid,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1, color: "#94a3b8" },
      },
      {
        name: "BOLL-LOW",
        type: "line",
        data: bollLow,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1, color: "#22c55e" },
      },
      {
        name: "MA5",
        type: "line",
        data: ma(5),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1 },
      },
      {
        name: "MA10",
        type: "line",
        data: ma(10),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1 },
      },
      {
        name: "MA20",
        type: "line",
        data: ma(20),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1 },
      },
      {
        name: "MA60",
        type: "line",
        data: ma(60),
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1 },
      },
      {
        name: "Vol",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
        itemStyle: { color: "#90caf9" },
      },
      // MACD on third grid
      {
        name: "MACD-Hist",
        type: "bar",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: hist,
        itemStyle: {
          color: (params: any) => (params.value >= 0 ? "#ef5350" : "#26a69a"),
        },
      },
      {
        name: "DIF",
        type: "line",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: dif,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1, color: "#f59e0b" },
      },
      {
        name: "DEA",
        type: "line",
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: dea,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1, color: "#60a5fa" },
      },
    ],
  }
}

function movingAverage(arr: number[], win: number) {
  const out = Array.from({ length: arr.length }).fill(null)
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i]!
    if (i >= win) sum -= arr[i - win]!
    if (i + 1 >= win) out[i] = +(sum / win).toFixed(2)
  }
  return out
}

function computeBOLL(closes: number[], n = 20, k = 2) {
  const mid = Array.from({ length: closes.length }).fill(null) as (number | null)[]
  const up = Array.from({ length: closes.length }).fill(null) as (number | null)[]
  const low = Array.from({ length: closes.length }).fill(null) as (number | null)[]
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i]!
    sum += c
    sumSq += c * c
    if (i >= n) {
      const prev = closes[i - n]!
      sum -= prev
      sumSq -= prev * prev
    }
    if (i + 1 >= n) {
      const mean = sum / n
      const variance = Math.max(0, sumSq / n - mean * mean)
      const sd = Math.sqrt(variance)
      mid[i] = +mean.toFixed(2)
      up[i] = +(mean + k * sd).toFixed(2)
      low[i] = +(mean - k * sd).toFixed(2)
    }
  }
  return { bollMid: mid, bollUp: up, bollLow: low }
}

function computeMACD(closes: number[], short = 12, long = 26, signal = 9) {
  const ema = (n: number) => {
    const out = Array.from({ length: closes.length }).fill(null) as (number | null)[]
    const alpha = 2 / (n + 1)
    let prev: number | null = null
    for (const [i, close_] of closes.entries()) {
      const c = close_!
      if (prev == null) prev = c
      else prev = alpha * c + (1 - alpha) * prev
      out[i] = +prev.toFixed(4)
    }
    return out
  }
  const emaShort = ema(short)
  const emaLong = ema(long)
  const dif = emaShort.map((v, i) =>
    v != null && emaLong[i] != null ? +(v - (emaLong[i] as number)).toFixed(4) : null,
  )
  // Signal EMA on DIF
  const dea = (() => {
    const out = Array.from({ length: dif.length }).fill(null) as (number | null)[]
    const alpha = 2 / (signal + 1)
    let prev: number | null = null
    for (const [i, d] of dif.entries()) {
      if (d == null) continue
      if (prev == null) prev = d
      else prev = alpha * d + (1 - alpha) * prev
      out[i] = +prev.toFixed(4)
    }
    return out
  })()
  const hist = dif.map((d, i) =>
    d != null && dea[i] != null ? +((d - (dea[i] as number)) * 2).toFixed(4) : null,
  )
  return { dif, dea, hist }
}
