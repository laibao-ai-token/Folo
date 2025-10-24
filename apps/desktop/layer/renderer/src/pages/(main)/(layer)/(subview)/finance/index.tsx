import { useQuery } from "@tanstack/react-query"
// Note: avoid useTranslation here to sidestep a rare deps equality bug when toggling cover view
import { useSearchParams } from "react-router"

// Avoid using useSubViewTitle here to bypass react-i18next callback deps issue on cover view
import { AsharesQuoteCard } from "~/modules/finance/AsharesQuoteCard"
import { useAsharesList, useLastAshares } from "~/modules/finance/atoms"
import { fetchQuoteByCode } from "~/modules/finance/eastmoney"
import { NasdaqIndexCard } from "~/modules/finance/NasdaqIndexCard"
import { fetchUsQuoteBySymbol } from "~/modules/finance/us"
import { UsQuoteCard } from "~/modules/finance/UsQuoteCard"

const typeName: Record<string, string> = {
  ashares: "A股",
  us: "美股",
  nasdaq: "纳斯达克指数",
  crypto: "虚拟货币",
}

export function Component() {
  const [search] = useSearchParams()
  // Set subview header title. When viewing a concrete A-share code, show its name in header.
  // Fallback to the finance word when no concrete target.

  const type = search.get("type") || ""
  const code = search.get("code") || ""
  const ashares = useAsharesList()
  const last = useLastAshares()
  const effectiveCode = type === "ashares" ? code || last?.code || ashares[0]?.code || "" : code
  const titleText = typeName[type as keyof typeof typeName]
  const nasdaqId = Number(search.get("id") || "") || undefined
  const showNasdaqDetails = type === "nasdaq" && (!!code || Number.isFinite(nasdaqId as any))

  // Always set a title via hook to keep hook order stable across renders
  // (do not call hooks conditionally to avoid React hook order errors)

  // If viewing a concrete A-share code, fetch its quote to show name in header
  const showAsharesQuoteInHeader = type === "ashares" && !!effectiveCode
  const quoteQuery = useQuery({
    queryKey: ["finance", "ashares", effectiveCode],
    queryFn: async () => await fetchQuoteByCode(effectiveCode),
    enabled: showAsharesQuoteInHeader,
    staleTime: 15_000,
  })

  // If viewing a concrete US symbol, fetch to show name in header
  const showUsQuoteInHeader = type === "us" && !!code
  const usHeaderQuery = useQuery({
    queryKey: ["finance", "us", code],
    queryFn: async () => await fetchUsQuoteBySymbol(code),
    enabled: showUsQuoteInHeader,
    staleTime: 15_000,
  })

  // Header title is rendered inline below; Subview header is optional for Finance

  return (
    <div className="flex size-full flex-col justify-center gap-6 px-6 py-8">
      <div className="mx-auto max-w-6xl text-center">
        <h1 className="text-text mb-4 text-3xl font-bold">
          {showAsharesQuoteInHeader && quoteQuery.data
            ? quoteQuery.data.name
            : showUsQuoteInHeader && usHeaderQuery.data
              ? usHeaderQuery.data.name
              : "金融"}
        </h1>
        {showAsharesQuoteInHeader && (
          <p className="text-text-secondary text-base">{quoteQuery.data?.code || effectiveCode}</p>
        )}
        {showUsQuoteInHeader && (
          <p className="text-text-secondary text-base">
            {(usHeaderQuery.data?.symbol || code).toUpperCase()}
          </p>
        )}
        {!showAsharesQuoteInHeader && titleText && (
          <p className="text-text-secondary text-base">{titleText}</p>
        )}
      </div>

      <div className="mx-auto w-full max-w-6xl">
        {type === "ashares" && (
          <AsharesQuoteCard defaultCode={effectiveCode || undefined} autoQuery={!!effectiveCode} />
        )}
        {type === "us" && !!code && (
          <UsQuoteCard defaultSymbol={code.toUpperCase()} autoQuery hideForm />
        )}
        {/* Nasdaq: show details only when a symbol/code is selected */}
        {showNasdaqDetails && (
          <NasdaqIndexCard defaultId={nasdaqId} defaultInput={code || undefined} />
        )}
        {/* Other types keep cover only for now */}
      </div>
    </div>
  )
}
