import { Input } from "@follow/components/ui/input/index.js"
import { useScrollElementUpdate } from "@follow/components/ui/scroll-area/hooks.js"
import { ScrollArea } from "@follow/components/ui/scroll-area/index.js"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"

import type { XHSFeedItem } from "~/queries/xhs"
import { fetchXhsRecommended, fetchXhsSearch } from "~/queries/xhs"

export const XhsTimeline = ({ compact }: { compact?: boolean }) => {
  const { t } = useTranslation()
  const [search, setSearch] = useSearchParams()
  const [keywordInput, setKeywordInput] = useState(search.get("keyword") || "")
  const { onUpdateMaxScroll } = useScrollElementUpdate()
  const [selected, setSelected] = useState<XHSFeedItem | null>(null)

  const keyword = (search.get("keyword") || "").trim()
  const isSearching = keyword.length > 0

  const { data, isLoading, isError, refetch } = useQuery<XHSFeedItem[]>({
    queryKey: isSearching ? ["xhs", "search", keyword] : ["xhs", "recommended"],
    queryFn: () =>
      isSearching
        ? fetchXhsSearch(keyword)
        : fetchXhsRecommended({
            limit: 15,
            concurrency: 3,
          }),
  })

  const items = Array.isArray(data) ? data : []

  const outerClassName = compact
    ? "flex size-full flex-col px-4 py-4"
    : "flex size-full flex-col px-6 py-8"

  return (
    <div className={outerClassName}>
      {/* Header */}
      <div className="mx-auto mb-6 max-w-6xl text-center">
        <h1 className="text-text mb-2 text-2xl font-bold">小红书推荐</h1>
        <p className="text-text-secondary text-sm">
          {isSearching
            ? t("words.search", { defaultValue: "搜索结果" })
            : "基于首页推荐的最新笔记流"}
        </p>
      </div>

      {/* Search bar */}
      <div className="mx-auto mb-6 flex w-full max-w-3xl items-center gap-3">
        <Input
          value={keywordInput}
          placeholder={t("words.search", { defaultValue: "输入关键词搜索小红书内容" }) as string}
          className="flex-1"
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setSearch(
                (prev) => {
                  const next = new URLSearchParams(prev)
                  if (keywordInput.trim()) next.set("keyword", keywordInput.trim())
                  else next.delete("keyword")
                  return next
                },
                { replace: false },
              )
              setSelected(null)
              onUpdateMaxScroll?.()
            }
          }}
        />
        <button
          type="button"
          className="bg-accent hover:bg-accent/90 text-accent-foreground inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium"
          onClick={() => {
            setSearch(
              (prev) => {
                const next = new URLSearchParams(prev)
                if (keywordInput.trim()) next.set("keyword", keywordInput.trim())
                else next.delete("keyword")
                return next
              },
              { replace: false },
            )
            setSelected(null)
            onUpdateMaxScroll?.()
          }}
        >
          <i className="i-mgc-search-cute-re" />
          <span>{t("words.search", { defaultValue: "搜索" })}</span>
        </button>

        {/* Refresh button: re-fetch recommended/search list */}
        <button
          type="button"
          className="border-border text-text-secondary inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm"
          onClick={() => {
            setSelected(null)
            refetch()
            onUpdateMaxScroll?.()
          }}
        >
          <i className="i-mgc-refresh-2-cute-re" />
          <span>{t("words.refresh", { defaultValue: "刷新推荐" })}</span>
        </button>
      </div>

      {/* Detail preview */}
      {selected && (
        <div className="border-border/70 bg-material-thick mx-auto mb-6 w-full max-w-5xl rounded-xl border p-4 text-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-text mb-1 text-base font-semibold">{selected.title}</div>
              <div className="text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {selected.author && <span>{selected.author}</span>}
                {(selected.likedCount || selected.commentCount) && (
                  <span className="flex items-center gap-2">
                    {typeof selected.likedCount === "number" && (
                      <span className="inline-flex items-center gap-1">
                        <i className="i-mgc-thumb-up-2-cute-re" />
                        <span>{selected.likedCount}</span>
                      </span>
                    )}
                    {typeof selected.commentCount === "number" && (
                      <span className="inline-flex items-center gap-1">
                        <i className="i-mgc-comment-cute-re" />
                        <span>{selected.commentCount}</span>
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            {selected.url && (
              <button
                type="button"
                className="text-accent hover:text-accent/90 inline-flex items-center gap-1 text-xs"
                onClick={() => {
                  window.open(selected.url, "_blank", "noopener,noreferrer")
                }}
              >
                <span>在小红书中打开</span>
                <i className="i-mgc-external-link-cute-re" />
              </button>
            )}
          </div>

          {selected.desc && (
            <p className="text-text-secondary whitespace-pre-wrap text-sm leading-relaxed">
              {selected.desc}
            </p>
          )}

          {selected.images && selected.images.length > 0 && (
            <div className="mt-3 flex gap-3 overflow-x-auto">
              {selected.images.map((src, idx) => (
                <div
                  key={idx}
                  className="bg-material-thin relative flex h-40 w-28 shrink-0 overflow-hidden rounded-md"
                >
                  <img
                    src={src}
                    alt={selected.title}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <ScrollArea.ScrollArea
          flex
          rootClassName="h-full w-full"
          viewportClassName="h-full w-full"
          onUpdateMaxScroll={onUpdateMaxScroll}
        >
          <div className="columns-1 gap-3 pb-12 sm:columns-2 lg:columns-3">
            {isLoading && <div className="text-text-secondary text-center text-sm">加载中…</div>}
            {isError && !isLoading && (
              <div className="text-text-secondary text-center text-sm">加载失败，请稍后重试。</div>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <div className="text-text-secondary text-center text-sm">
                {isSearching ? "没有找到相关笔记。" : "暂时没有推荐内容。"}
              </div>
            )}

            {items.map((item) => (
              <XhsFeedCard key={item.id} item={item} onSelect={() => setSelected(item)} />
            ))}
          </div>
        </ScrollArea.ScrollArea>
      </div>
    </div>
  )
}

const XhsFeedCard = ({ item, onSelect }: { item: XHSFeedItem; onSelect: () => void }) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="bg-fill-secondary/60 border-border/60 hover:bg-material-opaque mb-3 flex w-full cursor-pointer break-inside-avoid-column gap-4 rounded-xl border p-3 text-left transition-colors"
    >
      {item.cover && (
        <div className="bg-material-thin relative flex h-20 w-28 shrink-0 overflow-hidden rounded-md">
          <img
            src={item.cover}
            alt={item.title}
            className="size-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-text mb-1 truncate text-sm font-medium">{item.title}</div>
        <div className="text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {item.author && <span>{item.author}</span>}
          {(item.likedCount || item.commentCount) && (
            <span className="flex items-center gap-2">
              {typeof item.likedCount === "number" && (
                <span className="inline-flex items-center gap-1">
                  <i className="i-mgc-thumb-up-2-cute-re" />
                  <span>{item.likedCount}</span>
                </span>
              )}
              {typeof item.commentCount === "number" && (
                <span className="inline-flex items-center gap-1">
                  <i className="i-mgc-comment-cute-re" />
                  <span>{item.commentCount}</span>
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
