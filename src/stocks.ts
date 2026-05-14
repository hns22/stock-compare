export type Market = "KR" | "US";

export type StockDef = {
  symbol: string;
  nameKo: string;
  market: Market;
};

/** 한국·미국 시가총액 상위권에서 대표적으로 자주 비교되는 종목 */
export const STOCKS: StockDef[] = [
  { symbol: "005930.KS", nameKo: "삼성전자", market: "KR" },
  { symbol: "000660.KS", nameKo: "SK하이닉스", market: "KR" },
  { symbol: "005380.KS", nameKo: "현대차", market: "KR" },
  { symbol: "373220.KS", nameKo: "LG에너지솔루션", market: "KR" },
  { symbol: "035420.KS", nameKo: "NAVER", market: "KR" },
  { symbol: "AAPL", nameKo: "Apple", market: "US" },
  { symbol: "MSFT", nameKo: "Microsoft", market: "US" },
  { symbol: "AMZN", nameKo: "Amazon", market: "US" },
  { symbol: "GOOGL", nameKo: "Alphabet (Class A)", market: "US" },
  { symbol: "NVDA", nameKo: "NVIDIA", market: "US" },
];
