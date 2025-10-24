import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { AsharesKline } from "./AsharesKline"
import { setLastNasdaq } from "./atoms"
import type { NasdaqItem } from "./constants/nasdaq"
import { nasdaqItems } from "./constants/nasdaq"
import { fetchQuoteByCode } from "./eastmoney"
import { ensureEcharts, fetchUsKlineViaYahoo, fetchUsQuoteBySymbol } from "./us"

export function NasdaqIndexCard({
  defaultId,
  defaultInput,
}: {
  defaultId?: number
  defaultInput?: string
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<NasdaqItem | null>(null)

  const list = useMemo(() => nasdaqItems, [])

  // Override from query param `code` (US symbol or A-share code)
  const override = useMemo(() => {
    const s = (defaultInput || "").trim()
    if (!s) return null as null | { usSymbol?: string; cnCode?: string }
    if (/^[a-z.^-]{1,15}$/i.test(s)) return { usSymbol: s.toUpperCase() }
    return { cnCode: s }
  }, [defaultInput])

  // Preselect: only when explicit params present
  useEffect(() => {
    if (override) {
      setSelected(null)
      return
    }
    if (typeof defaultId === "number" && Number.isFinite(defaultId)) {
      const found = list.find((it) => it.id === defaultId) || null
      setSelected(found)
    } else {
      setSelected(null)
    }
  }, [defaultId, list, override])

  const activeUs = selected?.usSymbol || override?.usSymbol
  const activeCn = selected?.cnCode || override?.cnCode

  const usQuoteQuery = useQuery({
    queryKey: ["finance", "nasdaq", "us", activeUs],
    queryFn: async () => {
      if (!activeUs) throw new Error("empty")
      return await fetchUsQuoteBySymbol(activeUs)
    },
    enabled: !!activeUs,
    staleTime: 15_000,
  })

  const cnQuoteQuery = useQuery({
    queryKey: ["finance", "nasdaq", "cn", activeCn],
    queryFn: async () => {
      if (!activeCn) throw new Error("empty")
      return await fetchQuoteByCode(activeCn)
    },
    enabled: !!activeCn,
    staleTime: 15_000,
  })

  const usKlineQuery = useQuery({
    queryKey: ["finance", "nasdaq", "kline", activeUs],
    queryFn: async () => {
      if (!activeUs) throw new Error("empty")
      return await fetchUsKlineViaYahoo(activeUs, { range: "5y", interval: "1d" })
    },
    enabled: !!activeUs,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (selected) setLastNasdaq({ id: selected.id, name: selected.name })
  }, [selected])

  return (
    <div className="border-border bg-material-ultra-thin mx-auto w-full max-w-5xl rounded-lg border p-4">
      <div className="mb-3 text-base font-semibold">
        {t("finance.quick_links.nasdaq", { defaultValue: "纳斯达克指数" })}
      </div>

      {/* Quote */}
      <div className="mt-4 min-h-12">
        {activeUs && usQuoteQuery.error && (
          <div className="text-sm text-red-500">
            {(usQuoteQuery.error as Error).message || "报价请求失败"}
          </div>
        )}
        {activeCn && cnQuoteQuery.error && (
          <div className="text-sm text-red-500">
            {(cnQuoteQuery.error as Error).message || "报价请求失败"}
          </div>
        )}

        {activeUs && usQuoteQuery.isSuccess && usQuoteQuery.data && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <KV
              label={t("finance.kv.code", { defaultValue: "代码" })}
              value={usQuoteQuery.data.symbol}
            />
            <KV
              label={t("finance.kv.name", { defaultValue: "名称" })}
              value={usQuoteQuery.data.name}
            />
            <KV
              label={t("finance.kv.price", { defaultValue: "现价" })}
              value={usQuoteQuery.data.price.toFixed(2)}
            />
            <KV
              label={t("finance.kv.changePct", { defaultValue: "涨跌幅" })}
              value={`${usQuoteQuery.data.changePct.toFixed(2)}%`}
            />
            <KV
              label={t("finance.kv.open", { defaultValue: "开盘" })}
              value={usQuoteQuery.data.open.toFixed(2)}
            />
            <KV
              label={t("finance.kv.high", { defaultValue: "最高" })}
              value={usQuoteQuery.data.high.toFixed(2)}
            />
            <KV
              label={t("finance.kv.low", { defaultValue: "最低" })}
              value={usQuoteQuery.data.low.toFixed(2)}
            />
            <KV
              label={t("finance.kv.prevClose", { defaultValue: "昨收" })}
              value={usQuoteQuery.data.prevClose.toFixed(2)}
            />
            {usQuoteQuery.data.timestampMs && (
              <KV
                label={t("finance.kv.time", { defaultValue: "时间" })}
                value={new Date(usQuoteQuery.data.timestampMs).toLocaleString()}
              />
            )}
          </div>
        )}

        {activeCn && cnQuoteQuery.isSuccess && cnQuoteQuery.data && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <KV
              label={t("finance.kv.code", { defaultValue: "代码" })}
              value={cnQuoteQuery.data.code}
            />
            <KV
              label={t("finance.kv.name", { defaultValue: "名称" })}
              value={cnQuoteQuery.data.name}
            />
            <KV
              label={t("finance.kv.price", { defaultValue: "现价" })}
              value={cnQuoteQuery.data.price.toFixed(2)}
            />
            <KV
              label={t("finance.kv.changePct", { defaultValue: "涨跌幅" })}
              value={`${cnQuoteQuery.data.changePct.toFixed(2)}%`}
            />
            <KV
              label={t("finance.kv.open", { defaultValue: "开盘" })}
              value={cnQuoteQuery.data.open.toFixed(2)}
            />
            <KV
              label={t("finance.kv.high", { defaultValue: "最高" })}
              value={cnQuoteQuery.data.high.toFixed(2)}
            />
            <KV
              label={t("finance.kv.low", { defaultValue: "最低" })}
              value={cnQuoteQuery.data.low.toFixed(2)}
            />
            <KV
              label={t("finance.kv.prevClose", { defaultValue: "昨收" })}
              value={cnQuoteQuery.data.prevClose.toFixed(2)}
            />
          </div>
        )}
      </div>

      {/* Kline */}
      <div className="mt-4">
        {activeUs && usKlineQuery.error && (
          <div className="text-xs text-red-500">
            <span>
              {(usKlineQuery.error as Error).message || "K线请求失败"}（如遇到 Yahoo
              限流可稍后再试）
            </span>
          </div>
        )}
        {activeUs && usKlineQuery.isSuccess && usKlineQuery.data && (
          <UsKlineChart data={usKlineQuery.data} height={320} />
        )}

        {activeCn && <AsharesKline code={activeCn} years={5} klt={101} fqt={1} height={320} />}
      </div>

      {/* Legend removed by request */}
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-text flex items-center gap-2">
      <div className="text-text-secondary">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function UsKlineChart({
  data,
  height = 320,
}: {
  data: Awaited<ReturnType<typeof fetchUsKlineViaYahoo>>
  height?: number
}) {
  const id = `us-kline-${data.meta.symbol || "chart"}`
  return (
    <div className="w-full">
      <div className="text-text-tertiary mb-1 text-xs">
        <span>
          {data.meta.symbol} · {data.rows.length} bars
        </span>
      </div>
      <EChart id={id} data={data} height={height} />
    </div>
  )
}

function EChart({
  id,
  data,
  height,
}: {
  id: string
  data: Awaited<ReturnType<typeof fetchUsKlineViaYahoo>>
  height: number
}) {
  const containerId = id
  return (
    <div
      id={containerId}
      style={{ height, width: "100%" }}
      ref={(el) => {
        if (!el) return
        void (async () => {
          const echarts = await ensureEcharts()
          const chart = echarts.init(el)
          chart.setOption(buildOption(data))
        })()
      }}
    />
  )
}

function buildOption(payload: Awaited<ReturnType<typeof fetchUsKlineViaYahoo>>) {
  const category: string[] = []
  const values: [number, number, number, number][] = []
  const volumes: number[] = []
  for (const r of payload.rows) {
    category.push(r.time)
    values.push([r.open, r.close, r.low, r.high])
    volumes.push(r.volumeShares)
  }
  const closes = values.map((v) => v[1])
  const ma = (w: number) => movingAverage(closes, w)
  return {
    backgroundColor: "transparent",
    animation: false,
    grid: [
      { left: 8, right: 8, top: 4, height: "68%" },
      { left: 8, right: 8, top: "78%", height: "18%" },
    ],
    tooltip: { trigger: "axis" },
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
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
    ],
    yAxis: [{ scale: true }, { gridIndex: 1, scale: true }],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1], start: 60, end: 100 },
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
    ],
  } as const
}

function movingAverage(arr: number[], win: number) {
  const out = Array.from({ length: arr.length }).fill(null) as (number | null)[]
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i]!
    if (i >= win) sum -= arr[i - win]!
    if (i + 1 >= win) out[i] = +(sum / win).toFixed(2)
  }
  return out
}
