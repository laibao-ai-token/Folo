import { getStorageNS } from "@follow/utils/ns"
import { atomWithStorage } from "jotai/utils"

import { createAtomHooks } from "~/lib/jotai"

export type AsharesWatchItem = {
  code: string
  name: string
}

// Persisted open/close state for the A-shares group in sidebar
export const [, , useAsharesOpen, , getAsharesOpen, setAsharesOpen] = createAtomHooks(
  atomWithStorage(getStorageNS("finance-ashares-open"), false, undefined, {
    getOnInit: true,
  }),
)

// Persisted A-shares watchlist
export const [, , useAsharesList, , getAsharesList, setAsharesList] = createAtomHooks(
  atomWithStorage<AsharesWatchItem[]>(getStorageNS("finance-ashares-list"), [], undefined, {
    getOnInit: true,
  }),
)

export const addAsharesItem = (item: AsharesWatchItem) => {
  setAsharesList((prev) => {
    // de-duplicate by code
    if (prev.some((it) => it.code === item.code)) return prev
    return [...prev, item]
  })
}

export const removeAsharesItem = (code: string) => {
  setAsharesList((prev) => prev.filter((it) => it.code !== code))
}

// Remember last viewed/selected A-share to restore quickly on next visit
export type AsharesLastViewed = {
  code: string
  name: string
} | null

export const [, , useLastAshares, , getLastAshares, setLastAshares] = createAtomHooks(
  atomWithStorage<AsharesLastViewed>(getStorageNS("finance-ashares-last"), null, undefined, {
    getOnInit: true,
  }),
)

// -------------------- US stocks --------------------
export type UsWatchItem = {
  symbol: string
  name: string
}

export const [, , useUsOpen, , getUsOpen, setUsOpen] = createAtomHooks(
  atomWithStorage(getStorageNS("finance-us-open"), false, undefined, {
    getOnInit: true,
  }),
)

export const [, , useUsList, , getUsList, setUsList] = createAtomHooks(
  atomWithStorage<UsWatchItem[]>(getStorageNS("finance-us-list"), [], undefined, {
    getOnInit: true,
  }),
)

export const addUsItem = (item: UsWatchItem) => {
  setUsList((prev) => {
    if (prev.some((it) => it.symbol === item.symbol)) return prev
    return [...prev, item]
  })
}

export const removeUsItem = (symbol: string) => {
  setUsList((prev) => prev.filter((it) => it.symbol !== symbol))
}

export type UsLastViewed = {
  symbol: string
  name: string
} | null

export const [, , useLastUs, , getLastUs, setLastUs] = createAtomHooks(
  atomWithStorage<UsLastViewed>(getStorageNS("finance-us-last"), null, undefined, {
    getOnInit: true,
  }),
)

// -------------------- Nasdaq presets --------------------
export const [, , useNasdaqOpen, , getNasdaqOpen, setNasdaqOpen] = createAtomHooks(
  atomWithStorage(getStorageNS("finance-nasdaq-open"), false, undefined, {
    getOnInit: true,
  }),
)

export type NasdaqLastViewed = {
  id: number
  name: string
} | null

export const [, , useLastNasdaq, , getLastNasdaq, setLastNasdaq] = createAtomHooks(
  atomWithStorage<NasdaqLastViewed>(getStorageNS("finance-nasdaq-last"), null, undefined, {
    getOnInit: true,
  }),
)

export type NasdaqWatchItem = {
  // Either US symbol or A-share code
  usSymbol?: string
  cnCode?: string
  name: string
}

export const [, , useNasdaqList, , getNasdaqList, setNasdaqList] = createAtomHooks(
  atomWithStorage<NasdaqWatchItem[]>(getStorageNS("finance-nasdaq-list"), [], undefined, {
    getOnInit: true,
  }),
)

export const addNasdaqItem = (item: NasdaqWatchItem) => {
  setNasdaqList((prev) => {
    if (
      prev.some(
        (it) =>
          (item.usSymbol && it.usSymbol === item.usSymbol) ||
          (item.cnCode && it.cnCode === item.cnCode),
      )
    )
      return prev
    return [...prev, item]
  })
}

export const removeNasdaqItem = (key: { usSymbol?: string; cnCode?: string }) => {
  setNasdaqList((prev) =>
    prev.filter(
      (it) =>
        (key.usSymbol ? it.usSymbol !== key.usSymbol : true) &&
        (key.cnCode ? it.cnCode !== key.cnCode : true),
    ),
  )
}

// Hidden preset ids for Nasdaq list (allow users to hide built-in items)
export const [, , useNasdaqHidden, , getNasdaqHidden, setNasdaqHidden] = createAtomHooks(
  atomWithStorage<number[]>(getStorageNS("finance-nasdaq-hidden"), [], undefined, {
    getOnInit: true,
  }),
)

export const hideNasdaqPreset = (id: number) => {
  setNasdaqHidden((prev) => (prev.includes(id) ? prev : [...prev, id]))
}

export const unhideNasdaqPreset = (id: number) => {
  setNasdaqHidden((prev) => prev.filter((x) => x !== id))
}
