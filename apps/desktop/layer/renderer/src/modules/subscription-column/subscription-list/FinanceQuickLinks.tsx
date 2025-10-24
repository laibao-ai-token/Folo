import { stopPropagation } from "@follow/utils/dom"
import { cn } from "@follow/utils/utils"
import type { FC } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import {
  addAsharesItem,
  addNasdaqItem,
  addUsItem,
  hideNasdaqPreset,
  removeAsharesItem,
  removeNasdaqItem,
  removeUsItem,
  setAsharesOpen,
  setLastAshares,
  setLastNasdaq,
  setLastUs,
  setNasdaqOpen,
  setUsOpen,
  useAsharesList,
  useAsharesOpen,
  useLastAshares,
  useLastUs,
  useNasdaqHidden,
  useNasdaqList,
  useNasdaqOpen,
  useUsList,
  useUsOpen,
} from "~/modules/finance/atoms"
import { nasdaqItems } from "~/modules/finance/constants/nasdaq"
import { fetchQuoteByCode } from "~/modules/finance/eastmoney"
import { fetchUsQuoteBySymbol } from "~/modules/finance/us"

type Item = {
  type: "ashares" | "us" | "nasdaq" | "crypto"
  icon: string
  nameKey: I18nKeys
}

const items: Item[] = [
  // A-shares and US are rendered specially (collapsible)
  // Use existing local MingCute icons (icons/mgc)
  { type: "crypto", icon: "i-mgc-wallet-2-cute-fi", nameKey: "finance.quick_links.crypto" },
]

export const FinanceQuickLinks: FC = () => {
  const nav = useNavigate()
  const { t } = useTranslation()
  const asharesOpen = useAsharesOpen()
  const ashares = useAsharesList()
  const last = useLastAshares()
  const usOpen = useUsOpen()
  const nasdaqOpen = useNasdaqOpen()
  const nasdaqList = useNasdaqList()
  const nasdaqHidden = useNasdaqHidden()
  const usList = useUsList()
  const lastUs = useLastUs()

  return (
    <div className="mt-2 space-y-1">
      <div className="text-text-secondary mx-2 my-1 h-6 select-none text-xs font-semibold">
        {t("finance.quick_links.title")}
      </div>
      {/* A-shares collapsible section */}
      <div className="mx-1">
        <div
          role="button"
          className={cn(
            "hover:bg-material-opaque text-text group flex w-[calc(100%-0.0rem)] items-center gap-2 rounded-md px-2.5 py-2",
          )}
          onClick={(e) => {
            stopPropagation(e)
            // Navigate to A-shares with a sensible default symbol to avoid an empty Finance page.
            // Prefer last viewed item, then first in watchlist; fallback to cover when none.
            const target = last?.code || ashares[0]?.code
            if (target) nav(`/finance?type=ashares&code=${encodeURIComponent(target)}`)
            else nav(`/finance?type=ashares`)
            setAsharesOpen(!asharesOpen)
          }}
        >
          <i
            className={cn(
              "i-mgc-right-cute-re text-text-secondary transition-transform",
              asharesOpen && "rotate-90",
            )}
          />
          <i
            className={cn(
              "i-mgc-certificate-cute-re text-text-secondary group-hover:text-accent text-xl",
            )}
          />
          <span className="text-sm font-medium">{t("finance.quick_links.ashares")}</span>
        </div>

        {asharesOpen && (
          <div className="mt-1 space-y-1">
            {/* Add stock */}
            <button
              type="button"
              className={cn(
                "hover:bg-material-opaque text-text/90 group ml-6 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-md px-2.5 py-1.5 text-left",
              )}
              onClick={async (e) => {
                stopPropagation(e)
                const code = window.prompt(
                  t("finance.input.placeholder", {
                    defaultValue: "输入6位代码或带前缀，如 600000 或 sh600000",
                  }) as string,
                )
                const c = (code || "").trim()
                if (!c) return
                try {
                  const q = await fetchQuoteByCode(c)
                  addAsharesItem({ code: q.code, name: q.name })
                  setLastAshares({ code: q.code, name: q.name })
                  toast.success(`${q.name} (${q.code})`)
                  nav(`/finance?type=ashares&code=${encodeURIComponent(q.code)}`)
                } catch (err: any) {
                  toast.error(err?.message || "添加失败")
                }
              }}
            >
              <i className="i-mgc-add-cute-re text-text-secondary" />
              <span className="text-sm">{t("words.create", { defaultValue: "添加" })}</span>
            </button>

            {/* Watchlist items */}
            {ashares.map((it) => (
              <button
                key={it.code}
                type="button"
                className={cn(
                  "hover:bg-material-opaque text-text group ml-6 flex w-[calc(100%-1.5rem)] items-center justify-between rounded-md px-2.5 py-1.5 text-left",
                )}
                onClick={(e) => {
                  stopPropagation(e)
                  setLastAshares({ code: it.code, name: it.name })
                  nav(`/finance?type=ashares&code=${encodeURIComponent(it.code)}`)
                }}
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-text font-medium">{it.name}</span>
                  <span className="text-text-tertiary text-xs">{it.code}</span>
                </span>
                <i
                  className="i-mgc-delete-2-cute-re text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeAsharesItem(it.code)
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nasdaq presets + user list collapsible */}
      <div className="mx-1">
        <div
          role="button"
          className={cn(
            "hover:bg-material-opaque text-text group flex w-[calc(100%-0.0rem)] items-center gap-2 rounded-md px-2.5 py-2",
          )}
          onClick={(e) => {
            stopPropagation(e)
            // Navigate to a sensible default: first user item; otherwise first visible preset; fallback to cover.
            const userFirst = nasdaqList[0]
            const userCode = userFirst?.usSymbol || userFirst?.cnCode
            if (userCode) {
              nav(`/finance?type=nasdaq&code=${encodeURIComponent(userCode)}`)
            } else {
              const preset = nasdaqItems.find((it) => !nasdaqHidden.includes(it.id))
              if (preset) {
                const code = preset.usSymbol || preset.cnCode
                if (code) nav(`/finance?type=nasdaq&code=${encodeURIComponent(code)}`)
                else nav(`/finance?type=nasdaq&id=${preset.id}`)
              } else {
                nav(`/finance?type=nasdaq`)
              }
            }
            setNasdaqOpen(!nasdaqOpen)
          }}
        >
          <i
            className={cn(
              "i-mgc-right-cute-re text-text-secondary transition-transform",
              nasdaqOpen && "rotate-90",
            )}
          />
          <i
            className={cn(
              "i-mgc-trending-up-cute-re text-text-secondary group-hover:text-accent text-xl",
            )}
          />
          <span className="text-sm font-medium">{t("finance.quick_links.nasdaq")}</span>
        </div>

        {nasdaqOpen && (
          <div className="mt-1 space-y-1">
            {/* Add custom symbol or A-share code */}
            <button
              type="button"
              className={cn(
                "hover:bg-material-opaque text-text/90 group ml-6 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-md px-2.5 py-1.5 text-left",
              )}
              onClick={async (e) => {
                stopPropagation(e)
                const s = window.prompt(
                  t("finance.input.nasdaq.add.placeholder", {
                    defaultValue: "输入美股代码(如 QQQ) 或 A股代码(如 513100)",
                  }) as string,
                )
                const input = (s || "").trim()
                if (!input) return
                try {
                  if (/^[a-z.^-]{1,15}$/i.test(input)) {
                    const q = await fetchUsQuoteBySymbol(input.toUpperCase())
                    addNasdaqItem({ usSymbol: q.symbol, name: q.name })
                    setLastNasdaq({ id: 0, name: q.name })
                    toast.success(`${q.name} (${q.symbol})`)
                    nav(`/finance?type=nasdaq&code=${encodeURIComponent(q.symbol)}`)
                    return
                  }
                  const q2 = await fetchQuoteByCode(input)
                  addNasdaqItem({ cnCode: q2.code, name: q2.name })
                  setLastNasdaq({ id: 0, name: q2.name })
                  toast.success(`${q2.name} (${q2.code})`)
                  nav(`/finance?type=nasdaq&code=${encodeURIComponent(q2.code)}`)
                } catch (err: any) {
                  toast.error(err?.message || "添加失败")
                }
              }}
            >
              <i className="i-mgc-add-cute-re text-text-secondary" />
              <span className="text-sm">{t("words.create", { defaultValue: "添加" })}</span>
            </button>

            {/* User list */}
            {nasdaqList.map((it) => (
              <button
                key={(it.usSymbol || it.cnCode)!}
                type="button"
                className={cn(
                  "hover:bg-material-opaque text-text group ml-6 flex w-[calc(100%-1.5rem)] items-center justify-between rounded-md px-2.5 py-1.5 text-left",
                )}
                onClick={(e) => {
                  stopPropagation(e)
                  const target = it.usSymbol
                    ? encodeURIComponent(it.usSymbol)
                    : encodeURIComponent(it.cnCode!)
                  nav(`/finance?type=nasdaq&code=${target}`)
                }}
                title={it.name}
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-text max-w-40 truncate font-medium">{it.name}</span>
                  <span className="text-text-tertiary text-xs">{it.usSymbol || it.cnCode}</span>
                </span>
                <i
                  className="i-mgc-delete-2-cute-re text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (it.usSymbol) removeNasdaqItem({ usSymbol: it.usSymbol })
                    else removeNasdaqItem({ cnCode: it.cnCode! })
                  }}
                />
              </button>
            ))}

            {/* Presets (no numeric prefix) */}
            {nasdaqItems
              .filter((it) => !nasdaqHidden.includes(it.id))
              .map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={cn(
                    "hover:bg-material-opaque text-text group ml-6 flex w-[calc(100%-1.5rem)] items-center justify-between rounded-md px-2.5 py-1.5 text-left",
                  )}
                  onClick={(e) => {
                    stopPropagation(e)
                    const code = it.usSymbol || it.cnCode
                    if (code) nav(`/finance?type=nasdaq&code=${encodeURIComponent(code)}`)
                    else nav(`/finance?type=nasdaq&id=${it.id}`)
                  }}
                  title={it.name}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-text max-w-40 truncate font-medium">{it.name}</span>
                  </span>
                  <i
                    className="i-mgc-delete-2-cute-re text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      hideNasdaqPreset(it.id)
                      toast.success(t("words.deleted", { defaultValue: "已移除" }))
                    }}
                  />
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Other quick links */}
      {/* US stocks collapsible section */}
      <div className="mx-1">
        <div
          role="button"
          className={cn(
            "hover:bg-material-opaque text-text group flex w-[calc(100%-0.0rem)] items-center gap-2 rounded-md px-2.5 py-2",
          )}
          onClick={(e) => {
            stopPropagation(e)
            const target = lastUs?.symbol || usList[0]?.symbol
            if (target) nav(`/finance?type=us&code=${encodeURIComponent(target)}`)
            else nav(`/finance?type=us`)
            setUsOpen(!usOpen)
          }}
        >
          <i
            className={cn(
              "i-mgc-right-cute-re text-text-secondary transition-transform",
              usOpen && "rotate-90",
            )}
          />
          <i
            className={cn(
              "i-mgc-world-2-cute-re text-text-secondary group-hover:text-accent text-xl",
            )}
          />
          <span className="text-sm font-medium">{t("finance.quick_links.us")}</span>
        </div>

        {usOpen && (
          <div className="mt-1 space-y-1">
            <button
              type="button"
              className={cn(
                "hover:bg-material-opaque text-text/90 group ml-6 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-md px-2.5 py-1.5 text-left",
              )}
              onClick={async (e) => {
                stopPropagation(e)
                const s = window.prompt(
                  t("finance.input.us.placeholder", {
                    defaultValue: "输入代码，如 AAPL / NVDA",
                  }) as string,
                )
                const symbol = (s || "").trim().toUpperCase()
                if (!symbol) return
                try {
                  const q = await fetchUsQuoteBySymbol(symbol)
                  addUsItem({ symbol: q.symbol, name: q.name })
                  setLastUs({ symbol: q.symbol, name: q.name })
                  toast.success(`${q.name} (${q.symbol})`)
                  nav(`/finance?type=us&code=${encodeURIComponent(q.symbol)}`)
                } catch (err: any) {
                  toast.error(err?.message || "添加失败")
                }
              }}
            >
              <i className="i-mgc-add-cute-re text-text-secondary" />
              <span className="text-sm">{t("words.create", { defaultValue: "添加" })}</span>
            </button>

            {usList.map((it) => (
              <button
                key={it.symbol}
                type="button"
                className={cn(
                  "hover:bg-material-opaque text-text group ml-6 flex w-[calc(100%-1.5rem)] items-center justify-between rounded-md px-2.5 py-1.5 text-left",
                )}
                onClick={(e) => {
                  stopPropagation(e)
                  setLastUs({ symbol: it.symbol, name: it.name })
                  nav(`/finance?type=us&code=${encodeURIComponent(it.symbol)}`)
                }}
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-text font-medium">{it.name}</span>
                  <span className="text-text-tertiary text-xs">{it.symbol}</span>
                </span>
                <i
                  className="i-mgc-delete-2-cute-re text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeUsItem(it.symbol)
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Other quick links */}
      {items.map((it) => (
        <button
          key={it.type}
          type="button"
          className={cn(
            "hover:bg-material-opaque text-text group mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2.5 py-2 text-left",
          )}
          onClick={(e) => {
            stopPropagation(e)
            nav(`/finance?type=${it.type}`)
          }}
        >
          <i className={cn(it.icon, "text-text-secondary group-hover:text-accent text-xl")} />
          <span className="text-sm font-medium">{t(it.nameKey)}</span>
        </button>
      ))}
    </div>
  )
}
