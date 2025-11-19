import { env } from "@follow/shared/env.desktop"

const normalizeProxyBase = (): string | undefined => {
  const raw = env.VITE_FINANCE_PROXY_URL?.trim()
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.toString().replace(/\/$/, "")
  } catch {
    return raw.replace(/\/$/, "") || undefined
  }
}

const FINANCE_PROXY_BASE = normalizeProxyBase()

export const buildFinanceProxyUrl = (
  path: string,
  params: Record<string, string>,
): string | undefined => {
  if (!FINANCE_PROXY_BASE) return undefined
  const url = new URL(path, `${FINANCE_PROXY_BASE}/`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

export async function fetchFromFinanceProxy<T>(
  path: string,
  params: Record<string, string>,
): Promise<T | undefined> {
  const proxyUrl = buildFinanceProxyUrl(path, params)
  if (!proxyUrl) return undefined
  const res = await fetch(proxyUrl, { credentials: "include" })
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed.error === "string") message = parsed.error
    } catch {
      // ignore JSON parse errors for non-JSON bodies
    }
    throw new Error(message || `Proxy HTTP ${res.status}`)
  }
  return text ? (JSON.parse(text) as T) : (undefined as T)
}
