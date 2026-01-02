import { env } from "@follow/shared/env.desktop"

export type XHSFeedItem = {
  id: string
  title: string
  cover?: string
  author?: string
  likedCount?: number
  commentCount?: number
  url?: string
  desc?: string
  images?: string[]
}

type XHSFeedsWithDetailResponse = {
  items: Array<{
    feed: {
      id?: string
      noteCard?: {
        displayTitle?: string
        user?: {
          nickname?: string
          nickName?: string
        }
        cover?: {
          url?: string
          urlDefault?: string
        }
        interactInfo?: {
          likedCount?: number | string
          commentCount?: number | string
        }
      }
      noteID?: string
      noteId?: string
      note_id?: string
    }
    detail?: {
      note?: {
        desc?: string
        imageList?: Array<{
          url?: string
          urlDefault?: string
        }>
      }
      comments?: unknown
    }
  }>
}

const getBaseUrl = (): string => {
  return env.VITE_AI_API_URL || env.VITE_API_URL || ""
}

const mapFeedsToItems = (payload: XHSFeedsWithDetailResponse | null | undefined): XHSFeedItem[] => {
  if (!payload || !Array.isArray(payload.items)) return []

  return payload.items.map((item): XHSFeedItem => {
    const feed = (item as any).feed || ({} as any)
    const card = feed.noteCard || {}
    const cover = card.cover || {}
    const stats = card.interactInfo || {}
    const user = card.user || {}

    const id: string = feed.id || feed.noteID || feed.noteId || feed.note_id || ""

    const title: string = card.displayTitle || ""
    const author: string = user.nickname || user.nickName || ""
    const image: string = cover.urlDefault || cover.url || ""

    const likedCount =
      typeof stats.likedCount === "string"
        ? Number(stats.likedCount) || undefined
        : (stats.likedCount as number | undefined)

    const commentCount =
      typeof stats.commentCount === "string"
        ? Number(stats.commentCount) || undefined
        : (stats.commentCount as number | undefined)

    const rawDetail = (item as any).detail
    const note = rawDetail?.note || {}
    const desc = typeof note.desc === "string" ? note.desc : ""
    const images =
      Array.isArray(note.imageList) && note.imageList.length > 0
        ? note.imageList
            .map((img: any) => img?.urlDefault || img?.url || "")
            .filter((u: string) => !!u)
        : undefined

    const url = id ? `https://www.xiaohongshu.com/explore/${id}` : undefined

    return {
      id,
      title,
      author,
      cover: image,
      likedCount,
      commentCount,
      desc,
      images,
      url,
    }
  })
}

export const fetchXhsRecommended = async (params?: {
  limit?: number
  concurrency?: number
}): Promise<XHSFeedItem[]> => {
  const base = getBaseUrl()
  if (!base) return []

  const url = new URL("/xhs/feeds/recommended", base)
  if (params?.limit) url.searchParams.set("limit", String(params.limit))
  if (params?.concurrency) url.searchParams.set("concurrency", String(params.concurrency))

  const res = await fetch(url.toString())
  if (!res.ok) return []

  const raw = await res.json()
  const payload: XHSFeedsWithDetailResponse =
    raw && typeof raw === "object"
      ? "items" in (raw as any)
        ? (raw as XHSFeedsWithDetailResponse)
        : ((raw as any).data as XHSFeedsWithDetailResponse | undefined) || { items: [] }
      : { items: [] }

  return mapFeedsToItems(payload)
}

export const fetchXhsSearch = async (keyword: string): Promise<XHSFeedItem[]> => {
  const base = getBaseUrl()
  const trimmed = keyword.trim()
  if (!base || !trimmed) return []

  const url = new URL("/xhs/feeds/search", base)
  url.searchParams.set("keyword", trimmed)

  const res = await fetch(url.toString())
  if (!res.ok) return []

  const raw = await res.json()
  const payload: XHSFeedsWithDetailResponse =
    raw && typeof raw === "object"
      ? "items" in (raw as any)
        ? (raw as XHSFeedsWithDetailResponse)
        : ((raw as any).data as XHSFeedsWithDetailResponse | undefined) || { items: [] }
      : { items: [] }

  return mapFeedsToItems(payload)
}
