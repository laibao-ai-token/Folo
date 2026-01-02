import { cn } from "@follow/utils/utils"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { setLastUs } from "./atoms"
import {
  compute52WeekRange,
  computeAvgVolumes,
  computeDeviationThresholds,
  computeMASummary,
  judgeVolumeStatus,
} from "./eastmoney"
import { fetchUsKlineViaYahoo, fetchUsQuoteBySymbol } from "./us"
import type { UsTimeframe } from "./UsLineChart"
import { UsLineChart } from "./UsLineChart"

export function UsQuoteCard({
  defaultSymbol,
  autoQuery = false,
  hideForm = false,
}: { defaultSymbol?: string; autoQuery?: boolean; hideForm?: boolean } = {}) {
  const { t } = useTranslation()
  const [symbol, setSymbol] = useState(defaultSymbol ?? "")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<UsTimeframe>("1M")

  const quoteQuery = useQuery({
    queryKey: ["finance", "us", "quote", submitted],
    queryFn: async () => {
      if (!submitted) throw new Error("empty")
      return await fetchUsQuoteBySymbol(submitted)
    },
    enabled: false,
    staleTime: 15_000,
  })

  const klineQuery = useQuery({
    queryKey: ["finance", "us", "kline", submitted],
    queryFn: async () => {
      if (!submitted) throw new Error("empty")
      // Yahoo may limit; keep range modest
      return await fetchUsKlineViaYahoo(submitted, { range: "5y", interval: "1d" })
    },
    enabled: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (autoQuery && defaultSymbol && submitted !== defaultSymbol) {
      setSubmitted(defaultSymbol)
      Promise.resolve().then(() => {
        quoteQuery.refetch()
        klineQuery.refetch()
      })
    }
  }, [autoQuery, defaultSymbol, submitted, quoteQuery, klineQuery])

  useEffect(() => {
    if (quoteQuery.isSuccess && quoteQuery.data) {
      setLastUs({ symbol: quoteQuery.data.symbol, name: quoteQuery.data.name })
    }
  }, [quoteQuery.isSuccess, quoteQuery.data])

  return (
    <div
      className={cn(
        "mx-auto w-full",
        hideForm
          ? "max-w-6xl"
          : "border-border bg-material-ultra-thin max-w-xl rounded-lg border p-4",
      )}
    >
      {!hideForm && (
        <>
          <div className="mb-3 text-base font-semibold">
            {t("finance.quick_links.us", { defaultValue: "美股" })}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const s = symbol.trim()
              if (!s) return
              setSubmitted(s)
              quoteQuery.refetch()
              klineQuery.refetch()
            }}
          >
            <input
              placeholder={
                t("finance.input.us.placeholder", {
                  defaultValue: "输入代码，如 AAPL / NVDA",
                }) as string
              }
              className="bg-material-thin text-text placeholder:text-text-tertiary focus:ring-accent/40 h-9 w-64 rounded-md px-3 outline-none ring-1 ring-transparent"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
            <button
              type="submit"
              className={cn(
                "bg-accent h-9 rounded-md px-3 text-sm text-white",
                (quoteQuery.isFetching || klineQuery.isFetching) && "opacity-70",
              )}
              disabled={quoteQuery.isFetching || klineQuery.isFetching}
            >
              {quoteQuery.isFetching || klineQuery.isFetching
                ? t("words.loading", { defaultValue: "加载中" })
                : t("words.search")}
            </button>
          </form>
        </>
      )}

      <div className={cn("min-h-12", hideForm ? "mt-0" : "mt-4")}>
        {quoteQuery.error && (
          <div className="text-sm text-red-500">
            {(quoteQuery.error as any)?.message || "报价请求失败"}
          </div>
        )}
        {quoteQuery.isSuccess && quoteQuery.data && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm leading-6 md:grid-cols-3 xl:grid-cols-4">
            <KV
              label={t("finance.kv.code", { defaultValue: "代码" })}
              value={quoteQuery.data.symbol}
            />
            <KV
              label={t("finance.kv.name", { defaultValue: "名称" })}
              value={quoteQuery.data.name}
            />
            <KV
              label={t("finance.kv.price", { defaultValue: "现价" })}
              value={quoteQuery.data.price.toFixed(2)}
            />
            <KV
              label={t("finance.kv.changePct", { defaultValue: "涨跌幅" })}
              value={`${quoteQuery.data.changePct.toFixed(2)}%`}
            />
            <KV
              label={t("finance.kv.open", { defaultValue: "开盘" })}
              value={quoteQuery.data.open.toFixed(2)}
            />
            <KV
              label={t("finance.kv.high", { defaultValue: "最高" })}
              value={quoteQuery.data.high.toFixed(2)}
            />
            <KV
              label={t("finance.kv.low", { defaultValue: "最低" })}
              value={quoteQuery.data.low.toFixed(2)}
            />
            <KV
              label={t("finance.kv.prevClose", { defaultValue: "昨收" })}
              value={quoteQuery.data.prevClose.toFixed(2)}
            />
            {quoteQuery.data.timestampMs && (
              <KV
                label={t("finance.kv.time", { defaultValue: "时间" })}
                value={new Date(quoteQuery.data.timestampMs).toLocaleString()}
              />
            )}

            {/* Derived from kline: 52W range, MA20/60 dev, volumes, ratio */}
            {klineQuery.isSuccess &&
              klineQuery.data &&
              (() => {
                const rows = klineQuery.data.rows as any
                const { high52, low52 } = compute52WeekRange(rows, 260)
                if (high52 && low52 && high52 > low52 && quoteQuery.data) {
                  const pctl =
                    Math.max(0, Math.min(1, (quoteQuery.data.price - low52) / (high52 - low52))) *
                    100
                  return (
                    <>
                      <KV
                        label={t("finance.kv.high_52w", { defaultValue: "52周高" })}
                        value={high52.toFixed(2)}
                      />
                      <KV
                        label={t("finance.kv.low_52w", { defaultValue: "52周低" })}
                        value={low52.toFixed(2)}
                      />
                      <KV
                        label={t("finance.kv.pctl_52w", { defaultValue: "年内百分位" })}
                        value={`${pctl.toFixed(2)}%`}
                      />
                    </>
                  )
                }
              })()}

            {klineQuery.isSuccess &&
              klineQuery.data &&
              (() => {
                const rows = klineQuery.data.rows as any
                const { ma20, ma60 } = computeMASummary(rows)
                const dev20 = ma20 ? ((quoteQuery.data!.price - ma20) / ma20) * 100 : undefined
                const dev60 = ma60 ? ((quoteQuery.data!.price - ma60) / ma60) * 100 : undefined
                const th = computeDeviationThresholds(rows)
                const dev20Warn = th.dev20.p75 ?? 3
                const dev20High = th.dev20.p90 ?? 5
                const dev60Warn = th.dev60.p75 ?? 5
                const dev60High = th.dev60.p90 ?? 8
                const cls = (v?: number, warn?: number, high?: number) =>
                  typeof v === "number" && warn != null && high != null
                    ? Math.abs(v) >= high
                      ? "text-red"
                      : Math.abs(v) >= warn
                        ? "text-orange"
                        : ""
                    : ""
                return (
                  <>
                    {typeof ma20 === "number" && (
                      <KV
                        label={t("finance.kv.ma20", { defaultValue: "MA20" })}
                        value={ma20.toFixed(2)}
                      />
                    )}
                    {typeof dev20 === "number" && (
                      <KV
                        label={t("finance.kv.dev_ma20", { defaultValue: "偏离(MA20)" })}
                        value={`${dev20.toFixed(2)}%`}
                        className={cls(dev20, dev20Warn, dev20High)}
                      />
                    )}
                    {typeof ma60 === "number" && (
                      <KV
                        label={t("finance.kv.ma60", { defaultValue: "MA60" })}
                        value={ma60.toFixed(2)}
                      />
                    )}
                    {typeof dev60 === "number" && (
                      <KV
                        label={t("finance.kv.dev_ma60", { defaultValue: "偏离(MA60)" })}
                        value={`${dev60.toFixed(2)}%`}
                        className={cls(dev60, dev60Warn, dev60High)}
                      />
                    )}
                  </>
                )
              })()}

            {klineQuery.isSuccess &&
              klineQuery.data &&
              (() => {
                const rows = klineQuery.data.rows as any
                const { avgVol5, avgVol10, avgVol20 } = computeAvgVolumes(rows)
                const volRatio =
                  avgVol5 && avgVol5 > 0
                    ? (quoteQuery.data!.volumeShares || 0) / avgVol5
                    : undefined
                const status = judgeVolumeStatus(volRatio)
                const statusLabel =
                  status === "very-high"
                    ? t("finance.volume_status.very_high", { defaultValue: "显著放量" })
                    : status === "high"
                      ? t("finance.volume_status.high", { defaultValue: "放量" })
                      : status === "low"
                        ? t("finance.volume_status.low", { defaultValue: "缩量" })
                        : status === "very-low"
                          ? t("finance.volume_status.very_low", { defaultValue: "显著缩量" })
                          : t("finance.volume_status.normal", { defaultValue: "中性" })
                const ratioCls =
                  status === "very-high" || status === "very-low"
                    ? "text-red"
                    : status === "high" || status === "low"
                      ? "text-orange"
                      : ""
                return (
                  <>
                    {typeof avgVol5 === "number" && (
                      <KV
                        label={t("finance.kv.avg_vol5", { defaultValue: "5日均量" })}
                        value={avgVol5.toLocaleString()}
                      />
                    )}
                    {typeof avgVol10 === "number" && (
                      <KV
                        label={t("finance.kv.avg_vol10", { defaultValue: "10日均量" })}
                        value={avgVol10.toLocaleString()}
                      />
                    )}
                    {typeof avgVol20 === "number" && (
                      <KV
                        label={t("finance.kv.avg_vol20", { defaultValue: "20日均量" })}
                        value={avgVol20.toLocaleString()}
                      />
                    )}
                    {typeof volRatio === "number" && (
                      <KV
                        label={t("finance.kv.vol_ratio", { defaultValue: "量比(简)" })}
                        value={volRatio.toFixed(2)}
                        className={ratioCls}
                      />
                    )}
                    {status && (
                      <KV
                        label={t("finance.kv.volume_status", { defaultValue: "量能状态" })}
                        value={statusLabel}
                        className={ratioCls}
                      />
                    )}
                  </>
                )
              })()}
          </div>
        )}
      </div>

      {klineQuery.isSuccess && submitted && (
        <div className={cn(hideForm ? "mt-1" : "mt-2")}>
          {/* Timeframe switch */}
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as UsTimeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs",
                  timeframe === tf
                    ? "bg-fill-vibrant text-text"
                    : "bg-material-ultra-thin text-text-secondary hover:text-text",
                )}
              >
                {tf}
              </button>
            ))}
          </div>
          <UsLineChart symbol={submitted} timeframe={timeframe} height={220} />
        </div>
      )}
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-text flex min-w-0 flex-col gap-0.5">
      <div className="text-text-secondary whitespace-normal break-words text-xs leading-tight">
        {label}
      </div>
      <div className="text-sm tabular-nums leading-snug">{value}</div>
    </div>
  )
}
