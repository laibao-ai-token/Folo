import { Folo } from "@follow/components/icons/folo.js"
import { ScrollArea } from "@follow/components/ui/scroll-area/ScrollArea.js"
import { FeedViewType } from "@follow/constants"
import { useElementWidth } from "@follow/hooks"
import { useEntryIdsByView, useEntryList } from "@follow/store/entry/hooks"
import { clsx } from "@follow/utils"
import type { EditorState } from "lexical"
import { AnimatePresence, m } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"

import { useAISettingValue } from "~/atoms/settings/ai"
import { useGeneralSettingKey } from "~/atoms/settings/general"
import { AISpline } from "~/modules/ai-chat/components/3d-models/AISpline"
import { useAsharesList, useLastAshares } from "~/modules/finance/atoms"
import { fetchKlineByCode, fetchQuoteByCode } from "~/modules/finance/eastmoney"
import { fetchUsQuoteBySymbol } from "~/modules/finance/us"

import { useAttachScrollBeyond } from "../../hooks/useAttachScrollBeyond"
import { useMainEntryId } from "../../hooks/useMainEntryId"
import { useTimelineSummarySession } from "../../hooks/useTimelineSummarySession"
import { useChatActions, useChatError, useChatStatus, useMessages } from "../../store/hooks"
import { AIMessageParts } from "../message/AIMessageParts"
import { DefaultWelcomeContent, EntrySummaryCard } from "../welcome"
import { AIChatRoot } from "./AIChatRoot"

interface WelcomeScreenProps {
  onSend: (message: EditorState | string) => void
  centerInputOnEmpty?: boolean
}

export const WelcomeScreen = ({ onSend, centerInputOnEmpty }: WelcomeScreenProps) => {
  const { t } = useTranslation("ai")
  const aiSettings = useAISettingValue()
  const mainEntryId = useMainEntryId()
  const { todayTimelineSummaryId, canReuseTimelineSummary, hasEntryContext } =
    useTimelineSummarySession()
  const [search] = useSearchParams()
  const financeType = search.get("type") || ""
  const financeCodeParam = (search.get("code") || "").trim()
  const nasdaqId = Number(search.get("id") || "") || undefined
  const asharesList = useAsharesList()
  const lastAshares = useLastAshares()
  const effectiveFinanceCode = useMemo(() => {
    if (financeType === "ashares") {
      return financeCodeParam || lastAshares?.code || asharesList[0]?.code || ""
    }
    return financeCodeParam
  }, [financeType, financeCodeParam, lastAshares, asharesList])
  const enabledShortcuts = aiSettings.shortcuts?.filter((shortcut) => shortcut.enabled) || []
  const shouldFetchTimelineSummary = canReuseTimelineSummary

  const { handleScroll } = useAttachScrollBeyond()
  const showTimelineSummary = shouldFetchTimelineSummary
  const shouldFetchFinanceAnalysis =
    !hasEntryContext &&
    ((financeType === "ashares" && !!effectiveFinanceCode) ||
      (financeType === "us" && !!effectiveFinanceCode) ||
      (financeType === "nasdaq" && (!!effectiveFinanceCode || Number.isFinite(nasdaqId as any))))

  // todayTimelineSummaryId from hook

  return (
    <ScrollArea
      rootClassName="flex min-h-0 flex-1"
      viewportClassName="px-6 pt-24 flex min-h-0 grow"
      scrollbarClassName="mb-40 mt-12"
      flex
      onScroll={handleScroll}
    >
      <div className="mx-auto flex w-full flex-1 flex-col justify-center space-y-8 pb-52">
        {showTimelineSummary ? (
          <AIChatRoot chatId={todayTimelineSummaryId} generateId={() => todayTimelineSummaryId}>
            <TimelineSummarySection />
          </AIChatRoot>
        ) : (
          <DefaultWelcomeHeader
            description={
              hasEntryContext ? t("welcome_description_contextual") : t("welcome_description")
            }
          />
        )}

        {/* Dynamic Content Area */}
        <div
          className={clsx(
            "relative flex items-start justify-center",
            centerInputOnEmpty && "absolute bottom-0 translate-y-40",
          )}
        >
          <AnimatePresence mode="wait">
            {hasEntryContext && mainEntryId ? (
              <EntrySummaryCard key="entry-summary" entryId={mainEntryId} />
            ) : (
              <DefaultWelcomeContent
                key="default-welcome"
                onSend={onSend}
                shortcuts={enabledShortcuts}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* Trigger finance analysis silently when viewing a concrete finance symbol */}
      {shouldFetchFinanceAnalysis && (
        <FinanceAnalysisTrigger
          type={financeType}
          code={effectiveFinanceCode}
          nasdaqId={nasdaqId}
        />
      )}
    </ScrollArea>
  )
}

const DefaultWelcomeHeader = ({ description }: { description: string }) => (
  <m.div
    initial={{ opacity: 0, y: -20 }}
    animate={{ opacity: 1, y: 0 }}
    className="space-y-6 text-center"
  >
    <div className="mx-auto size-16">
      <AISpline />
    </div>
    <div className="flex flex-col gap-2">
      <h1 className="text-text flex items-center justify-center gap-2 text-2xl font-semibold">
        <Folo className="size-11" /> AI
      </h1>

      <p className="text-text-secondary text-balance text-sm">{description}</p>
    </div>
  </m.div>
)

const TimelineSummarySection = () => {
  const { getChatInstance } = useChatActions()

  const status = useChatStatus()
  const error = useChatError()
  const onceRef = useRef(false)
  const messages = useMessages()
  const hidePrivateSubscriptionsInTimeline = useGeneralSettingKey(
    "hidePrivateSubscriptionsInTimeline",
  )
  const allViewEntryIds = useEntryIdsByView(FeedViewType.All, hidePrivateSubscriptionsInTimeline)
  const TIMELINE_CONTEXT_LIMIT = 60
  const timelineEntries = useEntryList(
    useMemo(() => allViewEntryIds.slice(0, TIMELINE_CONTEXT_LIMIT), [allViewEntryIds]),
    (e) => ({
      id: e.id,
      title: e.title || "",
      url: e.url || "",
      content: e.readabilityContent || e.content || e.description || "",
      publishedAt: e.publishedAt,
    }),
  )

  const contextText = useMemo(() => {
    const items = (timelineEntries || []).filter(Boolean) as Array<
      NonNullable<typeof timelineEntries>[number]
    >
    if (items.length === 0) return

    const date = new Date()
    const header = `Context: Timeline entries for ${date.toLocaleDateString()}`
    const toPlain = (html: string) =>
      (html || "")
        .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
        .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
        .replaceAll(/<[^>]+>/g, " ")
        .replaceAll(/\s+/g, " ")
        .trim()

    const lines = items.map((e) => {
      const domain = (() => {
        try {
          return e.url ? new URL(e.url).hostname.replace(/^www\./, "") : ""
        } catch {
          return ""
        }
      })()
      const snippet = toPlain(e.content).slice(0, 240)
      const d = new Date(e.publishedAt)
      const time = Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString()
      return [
        `- ${e.title || "(no title)"}`,
        domain ? `  (${domain})` : "",
        time ? `  [${time}]` : "",
        e.url ? `\n  Link: ${e.url}` : "",
        snippet ? `\n  Snippet: ${snippet}` : "",
      ].join("")
    })
    return [header, "", ...lines].join("\n").slice(0, 32000)
  }, [timelineEntries])

  useEffect(() => {
    if (onceRef.current) return
    // Wait until we have some context to avoid generic summaries
    if (!contextText) return
    onceRef.current = true
    let isCancelled = false
    const fetchTimelineSummary = async () => {
      if (isCancelled) return
      await getChatInstance().sendMessage(
        {
          parts: [
            { type: "text", text: contextText },
            { type: "data-block", data: [] },
          ],
        },
        {
          body: { scene: "timeline-summary" },
        },
      )
    }

    fetchTimelineSummary()

    return () => {
      isCancelled = true
    }
  }, [getChatInstance, contextText])

  const message = messages.at(-1)

  const hasContent =
    message?.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.text.trim().length > 0
      }
      return true
    }) ?? false

  const { t } = useTranslation("ai")

  const messageContainerRef = useRef<HTMLDivElement>(null)
  const messageContainerWidth = useElementWidth(messageContainerRef)

  const isLoading = status === "streaming"
  const isError = status === "error"
  return (
    <m.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bg-material-ultra-thin border-border relative mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-2xl border p-7 text-left shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <i className="i-mgc-folo-bot-original size-10" />
            <div className="flex flex-col">
              <span className="text-text text-base font-semibold">
                {t("timeline_summary.heading")}
              </span>
              <span className="text-text-secondary text-xs">
                {isLoading ? t("timeline_summary.generating") : undefined}
              </span>
            </div>
          </div>
          {isLoading && (
            <i className="i-mgc-loading-3-cute-re text-text-secondary size-5 animate-spin" />
          )}
        </div>

        <div
          className="text-text flex select-text flex-col gap-2 text-sm leading-6"
          ref={messageContainerRef}
          style={
            {
              "--ai-chat-message-container-width": `${messageContainerWidth}px`,
              opacity: messageContainerWidth > 0 ? 1 : 0,
            } as React.CSSProperties
          }
        >
          {isError ? (
            <p className="text-text text-sm font-medium">{t("timeline_summary.error")}</p>
          ) : hasContent && message ? (
            <AIMessageParts message={message} isLastMessage={isLoading} />
          ) : (
            <p className="text-text-secondary text-sm">{t("timeline_summary.empty")}</p>
          )}
        </div>

        {import.meta.env.DEV && contextText && (
          <details className="text-left">
            <summary className="text-text-tertiary hover:text-text-secondary mb-2 cursor-pointer text-xs">
              Debug: Input context
            </summary>
            <pre className="bg-fill text-text-secondary border-border/40 max-h-64 cursor-text select-text overflow-auto whitespace-pre-wrap rounded-md border p-3 font-mono text-xs">
              {contextText}
            </pre>
          </details>
        )}

        {isError && error && <p className="text-text-secondary text-xs">{error.message}</p>}
      </div>
    </m.div>
  )
}

// Trigger-only component: when on Finance subview with a concrete symbol/code, send a one-shot
// context message to summarize/assess the symbol. It does not render visible UI; ChatInterface
// will switch from WelcomeScreen to message list once streaming starts.
const FinanceAnalysisTrigger = ({
  type,
  code,
  nasdaqId,
}: {
  type: string
  code: string
  nasdaqId?: number
}) => {
  const onceRef = useRef(false)
  const { getChatInstance } = useChatActions()
  const [context, setContext] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        switch (type) {
          case "ashares": {
            const q = await fetchQuoteByCode(code)
            // Try to enrich with 52-week range from daily bars
            let high52: number | undefined
            let low52: number | undefined
            let ma20: number | undefined
            let ma60: number | undefined
            try {
              const k = await fetchKlineByCode(code, { klt: 101, lmt: 260, fqt: 1 })
              if (k?.rows?.length) {
                for (const r of k.rows.slice(-260)) {
                  high52 = Math.max(high52 ?? -Infinity, r.high)
                  low52 = Math.min(low52 ?? Infinity, r.low)
                }
                // MA20/60 from closes
                const { rows } = k
                if (rows.length >= 60) {
                  let s20 = 0
                  let s60 = 0
                  for (let i = rows.length - 20; i < rows.length; i++) s20 += rows[i]!.close
                  for (let i = rows.length - 60; i < rows.length; i++) s60 += rows[i]!.close
                  ma20 = +(s20 / 20).toFixed(2)
                  ma60 = +(s60 / 60).toFixed(2)
                }
                // Volume averages and ratio (simple)
                let avgVol5: number | undefined
                let avgVol10: number | undefined
                let avgVol20: number | undefined
                if (rows.length >= 20) {
                  const sum = (n: number) => {
                    let s = 0
                    for (let i = rows.length - n; i < rows.length; i++) s += rows[i]!.volumeShares
                    return Math.round(s / n)
                  }
                  avgVol5 = sum(5)
                  avgVol10 = sum(10)
                  avgVol20 = sum(20)
                }
                if (avgVol5) {
                  linesExtra.push(
                    `AvgVol5: ${avgVol5}`,
                    `VolRatio(simple): ${(q.volumeShares / avgVol5).toFixed(2)}`,
                  )
                }
                if (avgVol10) linesExtra.push(`AvgVol10: ${avgVol10}`)
                if (avgVol20) linesExtra.push(`AvgVol20: ${avgVol20}`)
              }
            } catch {
              // ignore enrichment errors
            }
            if (cancelled) return
            const linesExtra: string[] = []
            const lines = [
              `Context: A-shares quote`,
              `Code: ${q.code}`,
              `Name: ${q.name}`,
              `Price: ${q.price.toFixed(2)}`,
              `Change: ${q.change.toFixed(2)} (${q.changePct.toFixed(2)}%)`,
              `Open: ${q.open.toFixed(2)}  High: ${q.high.toFixed(2)}  Low: ${q.low.toFixed(2)}  PrevClose: ${q.prevClose.toFixed(2)}`,
              `Volume(shares): ${q.volumeShares}`,
              `Turnover(CNY): ${q.turnoverYuan.toFixed(0)}`,
              `Amplitude(%): ${q.amplitudePct.toFixed(2)}`,
              Number.isFinite(q.turnoverRatePct)
                ? `TurnoverRate(%): ${q.turnoverRatePct.toFixed(2)}`
                : undefined,
              q.timestampMs ? `Time: ${new Date(q.timestampMs).toLocaleString()}` : undefined,
              typeof q.limitUp === "number" ? `LimitUp: ${q.limitUp.toFixed(2)}` : undefined,
              typeof q.limitDown === "number" ? `LimitDown: ${q.limitDown.toFixed(2)}` : undefined,
              q.sessionStatus ? `Session: ${q.sessionStatus}` : undefined,
              high52 && low52 && high52 > low52
                ? `High52: ${high52.toFixed(2)}  Low52: ${low52.toFixed(2)}  Pctl52(%): ${(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        (q.price - (low52 as number)) / ((high52 as number) - (low52 as number)),
                      ),
                    ) * 100
                  ).toFixed(2)}`
                : undefined,
              ma20
                ? `MA20: ${ma20.toFixed(2)}  Dev20(%): ${(((q.price - ma20) / ma20) * 100).toFixed(2)}`
                : undefined,
              ma60
                ? `MA60: ${ma60.toFixed(2)}  Dev60(%): ${(((q.price - ma60) / ma60) * 100).toFixed(2)}`
                : undefined,
              ...linesExtra,
            ]
            setContext(lines.join("\n"))

            break
          }
          case "us": {
            const q = await fetchUsQuoteBySymbol(code)
            if (cancelled) return
            const lines = [
              `Context: US quote`,
              `Symbol: ${q.symbol}`,
              `Name: ${q.name}`,
              `Price: ${q.price.toFixed(2)}`,
              `Change: ${q.change.toFixed(2)} (${q.changePct.toFixed(2)}%)`,
              `Open: ${q.open.toFixed(2)}  High: ${q.high.toFixed(2)}  Low: ${q.low.toFixed(2)}  PrevClose: ${q.prevClose.toFixed(2)}`,
              q.volumeShares ? `Volume(shares): ${q.volumeShares}` : undefined,
            ].filter(Boolean) as string[]
            setContext(lines.join("\n"))

            break
          }
          case "nasdaq": {
            // Prefer explicit code; if not present, try resolve by id (predefined list)
            let usSymbol: string | undefined
            let cnCode: string | undefined
            if (code) {
              if (/^[a-z.^-]{1,15}$/i.test(code)) usSymbol = code.toUpperCase()
              else cnCode = code
            } else if (typeof nasdaqId === "number" && Number.isFinite(nasdaqId)) {
              try {
                const { nasdaqItems } = await import("~/modules/finance/constants/nasdaq")
                const found = nasdaqItems.find((it) => it.id === nasdaqId)
                usSymbol = found?.usSymbol
                cnCode = found?.cnCode
              } catch {
                // ignore
              }
            }

            if (usSymbol) {
              const q = await fetchUsQuoteBySymbol(usSymbol)
              if (cancelled) return
              const lines = [
                `Context: US quote`,
                `Symbol: ${q.symbol}`,
                `Name: ${q.name}`,
                `Price: ${q.price.toFixed(2)}`,
                `Change: ${q.change.toFixed(2)} (${q.changePct.toFixed(2)}%)`,
                `Open: ${q.open.toFixed(2)}  High: ${q.high.toFixed(2)}  Low: ${q.low.toFixed(2)}  PrevClose: ${q.prevClose.toFixed(2)}`,
                q.volumeShares ? `Volume(shares): ${q.volumeShares}` : undefined,
              ].filter(Boolean) as string[]
              setContext(lines.join("\n"))
            } else if (cnCode) {
              const q = await fetchQuoteByCode(cnCode)
              if (cancelled) return
              const lines = [
                `Context: A-shares quote`,
                `Code: ${q.code}`,
                `Name: ${q.name}`,
                `Price: ${q.price.toFixed(2)}`,
                `Change: ${q.change.toFixed(2)} (${q.changePct.toFixed(2)}%)`,
                `Open: ${q.open.toFixed(2)}  High: ${q.high.toFixed(2)}  Low: ${q.low.toFixed(2)}  PrevClose: ${q.prevClose.toFixed(2)}`,
                `Volume(shares): ${q.volumeShares}`,
                `Turnover(CNY): ${q.turnoverYuan.toFixed(0)}`,
                `Amplitude(%): ${q.amplitudePct.toFixed(2)}`,
              ]
              setContext(lines.join("\n"))
            }

            break
          }
          // No default
        }
      } catch {
        // ignore
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [type, code, nasdaqId])

  useEffect(() => {
    if (onceRef.current) return
    if (!context) return
    onceRef.current = true
    getChatInstance().sendMessage(
      {
        parts: [
          {
            type: "text",
            text: `${context}\n\nTask: 请基于以上报价数据，进行不构成投资建议的客观分析。优先回答：短期趋势与关键价位、波动与风险点、可关注的催化/事件（如财报、政策、行业供需），以及需要进一步核实的数据。`,
          },
        ],
      },
      { body: { scene: "finance-analysis" } },
    )
  }, [context, getChatInstance])

  return null
}
