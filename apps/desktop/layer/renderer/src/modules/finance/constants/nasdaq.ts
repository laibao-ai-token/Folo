export type NasdaqItem = {
  id: number
  name: string
  usSymbol?: string
  cnCode?: string
}

export const nasdaqItems: NasdaqItem[] = [
  { id: 1, name: "NASDAQ-100 · QQQ", usSymbol: "QQQ" },
  { id: 2, name: "NASDAQ-100 · QQQM", usSymbol: "QQQM" },
  { id: 3, name: "NASDAQ Composite · ONEQ", usSymbol: "ONEQ" },
  { id: 4, name: "NASDAQ-100 Equal Weight · QQQE", usSymbol: "QQQE" },
  { id: 5, name: "Next Gen 100 · QQQJ", usSymbol: "QQQJ" },
  { id: 6, name: "Biotech · IBB", usSymbol: "IBB" },
  { id: 7, name: "China Dragon · PGJ", usSymbol: "PGJ" },
  { id: 8, name: "NASDAQ-100 +2x · QLD", usSymbol: "QLD" },
  { id: 9, name: "NASDAQ-100 +3x · TQQQ", usSymbol: "TQQQ" },
  { id: 10, name: "Inverse -1x · PSQ", usSymbol: "PSQ" },
  { id: 11, name: "Inverse -3x · SQQQ", usSymbol: "SQQQ" },
  { id: 21, name: "国泰纳指100ETF · 513100", cnCode: "513100" },
  { id: 22, name: "易方达纳指100ETF · 159915", cnCode: "159915" },
]
