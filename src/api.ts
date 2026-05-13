import type { Market } from "./stocks";

export type QuoteRow = {
  symbol: string;
  nameKo: string;
  market: Market;
  shortName: string;
  priceNative: number;
  currency: string;
  changePct: number | null;
  priceUsd: number;
};

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketChangePercent?: number;
};

type YahooQuoteResponse = {
  quoteResponse?: {
    result?: YahooQuote[];
    error?: { description?: string } | null;
  };
};

type FinnhubQuote = {
  c?: number;
  pc?: number;
  dp?: number;
};

type FrankfurterLatest = {
  rates?: { KRW?: number };
};

type NaverStockBasic = {
  stockName?: string;
  closePrice?: string;
  fluctuationsRatio?: string;
  itemCode?: string;
};

const CACHE_PREFIX = "stock-compare:v4:";
const CACHE_TTL_MS = 120_000;

let pendingFetch: Promise<{ quotes: QuoteRow[]; krwPerUsd: number }> | null =
  null;

function cacheKey(
  symbols: string[],
  source: "finnhub_naver" | "naver_yahoo",
): string {
  return `${CACHE_PREFIX}${source}:${symbols.join(",")}`;
}

function readCache(
  key: string,
): { quotes: QuoteRow[]; krwPerUsd: number } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      t: number;
      data: { quotes: QuoteRow[]; krwPerUsd: number };
    };
    if (Date.now() - parsed.t > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(
  key: string,
  data: { quotes: QuoteRow[]; krwPerUsd: number },
): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch {
    /* ignore quota */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function krCodeFromYahooSymbol(yahooSym: string): string {
  const base = yahooSym.split(".")[0]?.trim() ?? "";
  if (!/^\d{6}$/.test(base)) {
    throw new Error(`지원하지 않는 한국 티커 형식입니다: ${yahooSym}`);
  }
  return base;
}

function parseNaverPriceKrw(closePrice: string | undefined): number {
  if (!closePrice) return NaN;
  const n = Number(closePrice.replaceAll(",", "").trim());
  return n;
}

async function fetchKrwPerUsd(): Promise<number> {
  const res = await fetch("/frankfurter/v1/latest?from=USD&to=KRW");
  if (!res.ok) {
    throw new Error(`환율 요청 실패 (${res.status})`);
  }
  const data = (await res.json()) as FrankfurterLatest;
  const krw = data.rates?.KRW;
  if (!krw || krw <= 0) {
    throw new Error("USD/KRW 환율을 읽지 못했습니다.");
  }
  return krw;
}

/** 미국 시세(Yahoo)만 막혔을 때 안내 — Finnhub 키는 한국 시세와 무관합니다. */
function yahooBlockedMessage(): string {
  return [
    "Yahoo Finance(미국 종목) 요청이 차단(429/401)되었거나 접근이 제한되었습니다.",
    "한국 종목은 네이버 금융 API를 쓰므로, 이 메시지는 보통 미국 5종목 조회가 막힌 경우입니다.",
    "잠시 뒤 다시 시도하거나 VPN·다른 네트워크를 써 보세요.",
    "미국 종목을 Yahoo 없이 쓰려면 Finnhub API 키를 설정하세요(로컬: `stock-compare/.env`의 `VITE_FINNHUB_API_KEY`, 배포: 호스팅 대시보드 환경 변수).",
    "가입: https://finnhub.io/register",
  ].join(" ");
}

async function fetchQuotesNaverKr(
  krYahooSymbols: string[],
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
  krwPerUsd: number,
): Promise<QuoteRow[]> {
  if (krYahooSymbols.length === 0) return [];

  const rows = await Promise.all(
    krYahooSymbols.map(async (yahooSym) => {
      const code = krCodeFromYahooSymbol(yahooSym);
      const res = await fetch(`/naver/api/stock/${code}/basic`);
      if (!res.ok) {
        throw new Error(
          `네이버 금융 시세 실패 (${res.status}) — 종목코드 ${code}`,
        );
      }
      const j = (await res.json()) as NaverStockBasic;
      const price = parseNaverPriceKrw(j.closePrice);
      if (Number.isNaN(price) || price <= 0) {
        throw new Error(`네이버 금융: ${yahooSym} 가격을 읽지 못했습니다.`);
      }
      const fr = j.fluctuationsRatio?.trim();
      const changePct =
        fr == null || fr === ""
          ? null
          : Number.isNaN(Number(fr))
            ? null
            : Number(fr);
      const shortName = j.stockName ?? yahooSym;
      return {
        symbol: yahooSym,
        nameKo: nameBySymbol.get(yahooSym) ?? yahooSym,
        market: marketBySymbol.get(yahooSym) ?? "KR",
        shortName,
        priceNative: price,
        currency: "KRW",
        changePct,
        priceUsd: price / krwPerUsd,
      } satisfies QuoteRow;
    }),
  );

  const order = new Map(krYahooSymbols.map((s, i) => [s, i]));
  rows.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
  return rows;
}

async function fetchYahooOnce(
  stockSymbols: string[],
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
  krwPerUsd: number,
): Promise<QuoteRow[]> {
  const symbolsParam = stockSymbols.join(",");
  const url = import.meta.env.PROD
    ? `/api/yahoo?path=${encodeURIComponent("v7/finance/quote")}&symbols=${encodeURIComponent(symbolsParam)}`
    : `/yahoo/v7/finance/quote?symbols=${encodeURIComponent(symbolsParam)}`;
  const res = await fetch(url);
  if (res.status === 429 || res.status === 401) {
    throw new Error(yahooBlockedMessage());
  }
  if (!res.ok) {
    throw new Error(`시세 요청 실패 (${res.status})`);
  }
  const data = (await res.json()) as YahooQuoteResponse;
  const err = data.quoteResponse?.error;
  if (err?.description) {
    throw new Error(`${err.description} ${yahooBlockedMessage()}`);
  }
  const results = data.quoteResponse?.result ?? [];

  const quotes: QuoteRow[] = [];

  for (const q of results) {
    const sym = q.symbol;
    if (!sym) continue;
    const price = q.regularMarketPrice;
    if (price == null || Number.isNaN(price)) continue;

    const currency = (q.currency ?? "USD").toUpperCase();
    const priceUsd = currency === "KRW" ? price / krwPerUsd : price;
    const changeRaw = q.regularMarketChangePercent;
    const changePct =
      changeRaw == null || Number.isNaN(changeRaw) ? null : changeRaw;

    quotes.push({
      symbol: sym,
      nameKo: nameBySymbol.get(sym) ?? sym,
      market: marketBySymbol.get(sym) ?? "US",
      shortName: q.shortName ?? q.longName ?? sym,
      priceNative: price,
      currency,
      changePct,
      priceUsd,
    });
  }

  const order = new Map(stockSymbols.map((s, i) => [s, i]));
  quotes.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));

  return quotes;
}

async function fetchQuotesYahoo(
  stockSymbols: string[],
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
  krwPerUsd: number,
): Promise<QuoteRow[]> {
  try {
    return await fetchYahooOnce(
      stockSymbols,
      nameBySymbol,
      marketBySymbol,
      krwPerUsd,
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const retryable =
      m.includes("Yahoo Finance(미국 종목)") ||
      m.includes("시세 요청 실패 (429)") ||
      m.includes("시세 요청 실패 (401)");
    if (!retryable) throw e;
    await sleep(2200);
    return await fetchYahooOnce(
      stockSymbols,
      nameBySymbol,
      marketBySymbol,
      krwPerUsd,
    );
  }
}

function finnhubPrice(q: FinnhubQuote): number | null {
  const c = q.c;
  const pc = q.pc;
  if (c != null && !Number.isNaN(c) && c > 0) return c;
  if (pc != null && !Number.isNaN(pc) && pc > 0) return pc;
  return null;
}

/** Finnhub 무료 플랜은 미국 시장 위주라 `.KS` 등 해외 종목은 403이 납니다. */
async function fetchQuotesFinnhubUs(
  usSymbols: string[],
  token: string,
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
): Promise<QuoteRow[]> {
  if (usSymbols.length === 0) return [];

  const quotes = await Promise.all(
    usSymbols.map(async (symbol) => {
      const qs = new URLSearchParams({ symbol, token });
      const res = await fetch(`/finnhub/api/v1/quote?${qs}`);
      if (!res.ok) {
        const hint =
          res.status === 403
            ? " 무료 플랜은 미국 시장 시세만 허용되는 경우가 많습니다."
            : "";
        throw new Error(
          `Finnhub 시세 실패 (${res.status}). API 키·호출 한도를 확인해 주세요.${hint}`,
        );
      }
      const data = (await res.json()) as FinnhubQuote;
      const price = finnhubPrice(data);
      if (price == null) {
        throw new Error(`Finnhub: ${symbol} 가격을 읽지 못했습니다.`);
      }
      const market = marketBySymbol.get(symbol) ?? "US";
      const currency = "USD";
      const dp = data.dp;
      const changePct =
        dp == null || Number.isNaN(dp) ? null : (dp as number);
      const priceUsd = price;
      const row: QuoteRow = {
        symbol,
        nameKo: nameBySymbol.get(symbol) ?? symbol,
        market,
        shortName: symbol,
        priceNative: price,
        currency,
        changePct,
        priceUsd,
      };
      return row;
    }),
  );

  const order = new Map(usSymbols.map((s, i) => [s, i]));
  quotes.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
  return quotes;
}

function mergeQuoteRows(
  stockSymbols: string[],
  rows: QuoteRow[],
): QuoteRow[] {
  const by = new Map(rows.map((r) => [r.symbol, r]));
  return stockSymbols.map((s) => {
    const r = by.get(s);
    if (!r) {
      throw new Error(`시세 누락: ${s}`);
    }
    return r;
  });
}

export async function fetchQuotes(
  stockSymbols: string[],
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
): Promise<{ quotes: QuoteRow[]; krwPerUsd: number }> {
  const token = (import.meta.env.VITE_FINNHUB_API_KEY as string | undefined)
    ?.trim();
  const source: "finnhub_naver" | "naver_yahoo" = token
    ? "finnhub_naver"
    : "naver_yahoo";
  const ck = cacheKey(stockSymbols, source);
  const hit = readCache(ck);
  if (hit) return hit;

  if (pendingFetch) return pendingFetch;

  pendingFetch = (async () => {
    const krwPerUsd = await fetchKrwPerUsd();

    const kr = stockSymbols.filter((s) => marketBySymbol.get(s) === "KR");
    const us = stockSymbols.filter((s) => marketBySymbol.get(s) === "US");

    const [krRows, usRows] = await Promise.all([
      kr.length
        ? fetchQuotesNaverKr(kr, nameBySymbol, marketBySymbol, krwPerUsd)
        : Promise.resolve([] as QuoteRow[]),
      us.length
        ? token
          ? fetchQuotesFinnhubUs(us, token, nameBySymbol, marketBySymbol)
          : fetchQuotesYahoo(us, nameBySymbol, marketBySymbol, krwPerUsd)
        : Promise.resolve([] as QuoteRow[]),
    ]);

    const quotes = mergeQuoteRows(stockSymbols, [...krRows, ...usRows]);

    if (quotes.length === 0) {
      throw new Error("시세 결과가 비어 있습니다.");
    }

    const payload = { quotes, krwPerUsd };
    writeCache(ck, payload);
    return payload;
  })().finally(() => {
    pendingFetch = null;
  });

  return pendingFetch;
}
