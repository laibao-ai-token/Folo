import { cn } from "@follow/utils/utils"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import type { Timeframe as AsharesTimeframe } from "./AsharesLineChart"
import { AsharesLineChart } from "./AsharesLineChart"
import { setLastNasdaq } from "./atoms"
import type { NasdaqItem } from "./constants/nasdaq"
import { nasdaqItems } from "./constants/nasdaq"
import {
  compute52WeekRange,
  computeAvgVolumes,
  computeDeviationThresholds,
  computeMASummary,
  fetchKlineByCode,
  fetchQuoteByCode,
  judgeVolumeStatus,
} from "./eastmoney"
import { fetchUsKlineViaYahoo, fetchUsQuoteBySymbol } from "./us"
import type { UsTimeframe } from "./UsLineChart"
import { UsLineChart } from "./UsLineChart"

type UnifiedTimeframe = AsharesTimeframe & UsTimeframe

export function NasdaqIndexCard({
  defaultId,
  defaultInput,
}: {
  defaultId?: number
  defaultInput?: string
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<NasdaqItem | null>(null)
  const [timeframe, setTimeframe] = useState<UnifiedTimeframe>("1M")

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

  // For richer stats we need a kline payload, similar to A股/美股详情卡
  const usKlineQuery = useQuery({
    queryKey: ["finance", "nasdaq", "us", "kline", activeUs],
    queryFn: async () => {
      if (!activeUs) throw new Error("empty")
      return await fetchUsKlineViaYahoo(activeUs, { range: "5y", interval: "1d" })
    },
    enabled: !!activeUs,
    staleTime: 60_000,
  })

  const cnKlineQuery = useQuery({
    queryKey: ["finance", "nasdaq", "cn", "kline", activeCn],
    queryFn: async () => {
      if (!activeCn) throw new Error("empty")
      return await fetchKlineByCode(activeCn, { klt: 101, lmt: 260, fqt: 1 })
    },
    enabled: !!activeCn,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
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
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm leading-6 md:grid-cols-3 xl:grid-cols-4">
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
            {/* Derived from kline: 52W range, MA20/60 dev, volumes, ratio */}
            {usKlineQuery.isSuccess &&
              usKlineQuery.data &&
              (() => {
                const rows = usKlineQuery.data.rows as any
                const { high52, low52 } = compute52WeekRange(rows, 260)
                if (high52 && low52 && high52 > low52 && usQuoteQuery.data) {
                  const pctl =
                    Math.max(0, Math.min(1, (usQuoteQuery.data.price - low52) / (high52 - low52))) *
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

            {usKlineQuery.isSuccess &&
              usKlineQuery.data &&
              (() => {
                const rows = usKlineQuery.data.rows as any
                const { ma20, ma60 } = computeMASummary(rows)
                const dev20 = ma20 ? ((usQuoteQuery.data!.price - ma20) / ma20) * 100 : undefined
                const dev60 = ma60 ? ((usQuoteQuery.data!.price - ma60) / ma60) * 100 : undefined
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

            {usKlineQuery.isSuccess &&
              usKlineQuery.data &&
              (() => {
                const rows = usKlineQuery.data.rows as any
                const { avgVol5, avgVol10, avgVol20 } = computeAvgVolumes(rows)
                const volRatio =
                  avgVol5 && avgVol5 > 0
                    ? (usQuoteQuery.data!.volumeShares || 0) / avgVol5
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
                          ? t("finance.volume_status.very_low", {
                              defaultValue: "显著缩量",
                            })
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

        {activeCn && cnQuoteQuery.isSuccess && cnQuoteQuery.data && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm leading-6 md:grid-cols-3 xl:grid-cols-4">
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
            <KV
              label={t("finance.kv.volume", { defaultValue: "成交量" })}
              value={cnQuoteQuery.data.volumeShares.toLocaleString()}
            />
            <KV
              label={t("finance.kv.amount", { defaultValue: "成交额(¥)" })}
              value={Math.round(cnQuoteQuery.data.turnoverYuan).toLocaleString()}
            />
            <KV
              label={t("finance.kv.amplitude", { defaultValue: "振幅" })}
              value={`${cnQuoteQuery.data.amplitudePct.toFixed(2)}%`}
            />
            {Number.isFinite(cnQuoteQuery.data.turnoverRatePct) && (
              <KV
                label={t("finance.kv.turnoverRate", { defaultValue: "换手率" })}
                value={`${cnQuoteQuery.data.turnoverRatePct.toFixed(2)}%`}
              />
            )}
            {cnQuoteQuery.data.timestampMs && (
              <KV
                label={t("finance.kv.time", { defaultValue: "时间" })}
                value={new Date(cnQuoteQuery.data.timestampMs).toLocaleString()}
              />
            )}

            {/* 52-week range and percentile */}
            {cnKlineQuery.isSuccess &&
              cnKlineQuery.data &&
              (() => {
                const { high52, low52 } = compute52WeekRange(cnKlineQuery.data.rows, 260)
                if (!high52 || !low52 || high52 <= low52) return null
                const pctl =
                  Math.max(0, Math.min(1, (cnQuoteQuery.data.price - low52) / (high52 - low52))) *
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
              })()}

            {/* MA & deviation to MA20/60 with adaptive thresholds */}
            {cnKlineQuery.isSuccess &&
              cnKlineQuery.data &&
              (() => {
                const { rows } = cnKlineQuery.data
                const { ma20, ma60 } = computeMASummary(rows)
                if (!ma20 && !ma60) return null
                const dev20 =
                  typeof ma20 === "number" && ma20 !== 0
                    ? ((cnQuoteQuery.data.price - ma20) / ma20) * 100
                    : undefined
                const dev60 =
                  typeof ma60 === "number" && ma60 !== 0
                    ? ((cnQuoteQuery.data.price - ma60) / ma60) * 100
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
                  </>
                )
              })()}

            {/* Volume averages and ratio */}
            {cnKlineQuery.isSuccess &&
              cnKlineQuery.data &&
              (() => {
                const { rows } = cnKlineQuery.data
                const { avgVol5, avgVol10, avgVol20 } = computeAvgVolumes(rows)
                const volRatio =
                  avgVol5 && avgVol5 > 0 ? cnQuoteQuery.data.volumeShares / avgVol5 : undefined
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

            {typeof cnQuoteQuery.data.limitUp === "number" && (
              <KV
                label={t("finance.kv.limit_up", { defaultValue: "涨停价" })}
                value={cnQuoteQuery.data.limitUp.toFixed(2)}
              />
            )}
            {typeof cnQuoteQuery.data.limitDown === "number" && (
              <KV
                label={t("finance.kv.limit_down", { defaultValue: "跌停价" })}
                value={cnQuoteQuery.data.limitDown.toFixed(2)}
              />
            )}
            {cnQuoteQuery.data.sessionStatus && (
              <KV
                label={t("finance.kv.session", { defaultValue: "交易状态" })}
                value={
                  cnQuoteQuery.data.sessionStatus === "open"
                    ? t("words.open", { defaultValue: "开盘" })
                    : t("words.close", { defaultValue: "休市" })
                }
              />
            )}
          </div>
        )}
      </div>

      {/* Chart: align with A股 / 美股卡片的折线图样式 */}
      <div className="mt-4">
        {(activeUs || activeCn) && (
          <>
            <div className="mb-1 flex flex-wrap items-center gap-1">
              {(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as UnifiedTimeframe[]).map(
                (tf) => (
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
                ),
              )}
            </div>

            {activeUs && <UsLineChart symbol={activeUs} timeframe={timeframe} height={220} />}
            {activeCn && <AsharesLineChart code={activeCn} timeframe={timeframe} height={220} />}
          </>
        )}
      </div>
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
