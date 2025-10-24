import { cn } from "@follow/utils/utils"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import type { Timeframe } from "./AsharesLineChart"
import { AsharesLineChart } from "./AsharesLineChart"
import { setLastAshares } from "./atoms"
import {
  compute52WeekRange,
  computeAvgVolumes,
  computeDeviationThresholds,
  computeMASummary,
  fetchKlineByCode,
  fetchQuoteByCode,
  judgeVolumeStatus,
} from "./eastmoney"

export function AsharesQuoteCard({
  defaultCode,
  autoQuery = false,
  hideForm = false,
}: { defaultCode?: string; autoQuery?: boolean; hideForm?: boolean } = {}) {
  const { t } = useTranslation()
  const [code, setCode] = useState(defaultCode ?? "")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [pageVisible, setPageVisible] = useState<boolean>(true)
  const [timeframe, setTimeframe] = useState<Timeframe>("1M")

  // Track page visibility to pause polling when tab is hidden
  useEffect(() => {
    const handler = () => setPageVisible(document.visibilityState === "visible")
    handler()
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [])

  // Simple CN market session window: 09:30–11:30, 13:00–15:00 (UTC+8), weekdays
  const isCnSessionOpenNow = useMemo(() => {
    const now = new Date()
    const utc8 = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 8 * 3600000)
    const dow = utc8.getUTCDay()
    if (dow === 0 || dow === 6) return false
    const hm = utc8.getUTCHours() * 60 + utc8.getUTCMinutes()
    return (hm >= 9 * 60 + 30 && hm < 11 * 60 + 30) || (hm >= 13 * 60 && hm < 15 * 60)
  }, [])

  const { data, isFetching, error, isSuccess } = useQuery({
    queryKey: ["finance", "ashares", submitted],
    queryFn: async () => {
      if (!submitted) throw new Error("empty")
      return await fetchQuoteByCode(submitted)
    },
    enabled: !!submitted,
    staleTime: 10_000,
    refetchInterval: () => (pageVisible && isCnSessionOpenNow && submitted ? 10_000 : false),
    refetchOnWindowFocus: false,
  })

  // 52-week range: fetch last ~260 daily bars once per code, compute high/low; Pctl uses live price
  const rangeQuery = useQuery({
    queryKey: ["finance", "ashares", "range52w", submitted],
    queryFn: async () => {
      if (!submitted) throw new Error("empty")
      return await fetchKlineByCode(submitted, { klt: 101, lmt: 260, fqt: 1 })
    },
    enabled: !!submitted,
    staleTime: 60 * 60 * 1000, // 1h is enough; high/low & thresholds日内基本稳定
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (autoQuery && defaultCode && submitted !== defaultCode) {
      setSubmitted(defaultCode)
    }
  }, [autoQuery, defaultCode, submitted])

  // Remember last viewed stock once we have successful data
  useEffect(() => {
    if (isSuccess && data) {
      setLastAshares({ code: data.code, name: data.name })
    }
  }, [isSuccess, data])

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
          <div className="mb-3 text-base font-semibold">{t("finance.quick_links.ashares")}</div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const c = code.trim()
              if (!c) return
              setSubmitted(c)
            }}
          >
            <input
              placeholder={
                t("finance.input.placeholder", {
                  defaultValue: "输入6位代码或带前缀，如 600000 或 sh600000",
                }) as string
              }
              className="bg-material-thin text-text placeholder:text-text-tertiary focus:ring-accent/40 h-9 w-64 rounded-md px-3 outline-none ring-1 ring-transparent"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="submit"
              className={cn(
                "bg-accent h-9 rounded-md px-3 text-sm text-white",
                isFetching && "opacity-70",
              )}
              disabled={isFetching}
            >
              {isFetching ? t("words.loading", { defaultValue: "加载中" }) : t("words.search")}
            </button>
          </form>
        </>
      )}

      <div className={cn("min-h-12", hideForm ? "mt-0" : "mt-4")}>
        {error && (
          <div className="text-sm text-red-500">{(error as any)?.message || "请求失败"}</div>
        )}
        {isSuccess && data && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm leading-6 md:grid-cols-3 xl:grid-cols-4">
              <KV label={t("finance.kv.code", { defaultValue: "代码" })} value={data.code} />
              <KV label={t("finance.kv.name", { defaultValue: "名称" })} value={data.name} />
              <KV
                label={t("finance.kv.price", { defaultValue: "现价" })}
                value={data.price.toFixed(2)}
              />
              <KV
                label={t("finance.kv.changePct", { defaultValue: "涨跌幅" })}
                value={`${data.changePct.toFixed(2)}%`}
              />
              <KV
                label={t("finance.kv.open", { defaultValue: "开盘" })}
                value={data.open.toFixed(2)}
              />
              <KV
                label={t("finance.kv.high", { defaultValue: "最高" })}
                value={data.high.toFixed(2)}
              />
              <KV
                label={t("finance.kv.low", { defaultValue: "最低" })}
                value={data.low.toFixed(2)}
              />
              <KV
                label={t("finance.kv.prevClose", { defaultValue: "昨收" })}
                value={data.prevClose.toFixed(2)}
              />
              <KV
                label={t("finance.kv.volume", { defaultValue: "成交量" })}
                value={data.volumeShares.toLocaleString()}
              />
              <KV
                label={t("finance.kv.amount", { defaultValue: "成交额(¥)" })}
                value={Math.round(data.turnoverYuan).toLocaleString()}
              />
              <KV
                label={t("finance.kv.amplitude", { defaultValue: "振幅" })}
                value={`${data.amplitudePct.toFixed(2)}%`}
              />
              {Number.isFinite(data.turnoverRatePct) && (
                <KV
                  label={t("finance.kv.turnoverRate", { defaultValue: "换手率" })}
                  value={`${data.turnoverRatePct.toFixed(2)}%`}
                />
              )}
              {data.timestampMs && (
                <KV
                  label={t("finance.kv.time", { defaultValue: "时间" })}
                  value={new Date(data.timestampMs).toLocaleString()}
                />
              )}
              {/* 52-week range and percentile */}
              {rangeQuery.isSuccess &&
                rangeQuery.data &&
                (() => {
                  const { high52, low52 } = compute52WeekRange(rangeQuery.data.rows, 260)
                  if (!high52 || !low52 || high52 <= low52) return null
                  const pctl =
                    Math.max(0, Math.min(1, (data.price - low52) / (high52 - low52))) * 100
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
                })()}
              {/* MA & deviation to MA20/60 with adaptive thresholds (P75/P90) and default fallbacks */}
              {rangeQuery.isSuccess &&
                rangeQuery.data &&
                (() => {
                  const { rows } = rangeQuery.data
                  const { ma20, ma60 } = computeMASummary(rows)
                  if (!ma20 && !ma60) return null
                  const dev20 =
                    typeof ma20 === "number" && ma20 !== 0
                      ? ((data.price - ma20) / ma20) * 100
                      : undefined
                  const dev60 =
                    typeof ma60 === "number" && ma60 !== 0
                      ? ((data.price - ma60) / ma60) * 100
                      : undefined
                  const th = computeDeviationThresholds(rows)
                  const dev20Warn = th.dev20.p75 ?? 3
                  const dev20High = th.dev20.p90 ?? 5
                  const dev60Warn = th.dev60.p75 ?? 5
                  const dev60High = th.dev60.p90 ?? 8
                  const cls = (v: number | undefined, warn: number, high: number) =>
                    typeof v === "number"
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
                      {/* Volume averages and ratio (simple) */}
                      {(() => {
                        const { avgVol5, avgVol10, avgVol20 } = computeAvgVolumes(rows)
                        const volRatio =
                          avgVol5 && avgVol5 > 0 ? data.volumeShares / avgVol5 : undefined
                        const status = judgeVolumeStatus(volRatio)
                        const statusLabel =
                          status === "very-high"
                            ? t("finance.volume_status.very_high", { defaultValue: "显著放量" })
                            : status === "high"
                              ? t("finance.volume_status.high", { defaultValue: "放量" })
                              : status === "low"
                                ? t("finance.volume_status.low", { defaultValue: "缩量" })
                                : status === "very-low"
                                  ? t("finance.volume_status.very_low", {
                                      defaultValue: "显著缩量",
                                    })
                                  : t("finance.volume_status.normal", { defaultValue: "中性" })
                        const ratioCls =
                          status === "very-high"
                            ? "text-red"
                            : status === "high"
                              ? "text-orange"
                              : status === "very-low"
                                ? "text-red"
                                : status === "low"
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
                    </>
                  )
                })()}
              {typeof data.limitUp === "number" && (
                <KV
                  label={t("finance.kv.limit_up", { defaultValue: "涨停价" })}
                  value={data.limitUp.toFixed(2)}
                />
              )}
              {typeof data.limitDown === "number" && (
                <KV
                  label={t("finance.kv.limit_down", { defaultValue: "跌停价" })}
                  value={data.limitDown.toFixed(2)}
                />
              )}
              {data.sessionStatus && (
                <KV
                  label={t("finance.kv.session", { defaultValue: "交易状态" })}
                  value={
                    data.sessionStatus === "open"
                      ? t("words.open", { defaultValue: "开盘" })
                      : t("words.close", { defaultValue: "休市" })
                  }
                />
              )}
            </div>
            {/* Timeframe switch */}
            <div className="mb-1 flex flex-wrap items-center gap-1">
              {(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as Timeframe[]).map((tf) => (
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
            {/* Line chart with timeframe */}
            <AsharesLineChart code={submitted!} timeframe={timeframe} height={220} />
          </>
        )}
      </div>
    </div>
  )
}

function KV({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="text-text flex min-w-0 flex-col gap-0.5">
      <div className="text-text-secondary whitespace-normal break-words text-xs leading-tight">
        {label}
      </div>
      <div className={cn("text-sm tabular-nums leading-snug", className)}>{value}</div>
    </div>
  )
}
