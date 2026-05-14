import type { Market } from "./stocks";

export type QuoteRow = {
  symbol: string;
  nameKo: string;
  market: Market;
  shortName: string;
  priceNative: number;
  currency: string;
  changePct: number | null;
  /** 표시용 시가총액: 한국은 KRW(조), 미국은 USD($) 문자열. 없으면 null */
  marketCapText: string | null;
  /** 시총 정렬용: 한국은 원화 총액, 미국은 USD 총액. 같은 시장 안에서만 비교 */
  marketCapSortValue: number | null;
};

/** 시세 조회 결과(항상 resolve; `userNotice`는 안내 문구만) */
export type FetchQuotesResult = {
  quotes: QuoteRow[];
  krwPerUsd: number;
  /** null이면 정상·캐시 적중 등으로 별도 안내 없음 */
  userNotice: string | null;
};

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketChangePercent?: number;
  marketCap?: number;
  regularMarketMarketCap?: number;
};

type YahooQuoteResponse = {
  quoteResponse?: {
    result?: YahooQuote[];
    error?: { description?: string } | null;
  };
};

/** v7 quote에 시총이 없을 때 보강용 */
type YahooQuoteSummary = {
  quoteSummary?: {
    result?: Array<{
      summaryDetail?: {
        marketCap?: { raw?: number };
      };
    }>;
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

type NaverTotalInfo = { code?: string; value?: string };

type NaverIntegration = {
  totalInfos?: NaverTotalInfo[];
};

type FinnhubProfile = {
  marketCapitalization?: number | string;
};

const CACHE_PREFIX = "stock-compare:v12:";
const CACHE_TTL_MS = 120_000;
/** 환율 API 실패 시 요약·표시용 (고정값, 실시간 아님) */
const FALLBACK_KRW_PER_USD = 1_430;

let pendingFetch: Promise<FetchQuotesResult> | null = null;

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
    const data = parsed.data;
    if (
      !Array.isArray(data.quotes) ||
      data.quotes.some(
        (q) =>
          !(q && typeof q === "object" && "marketCapText" in q) ||
          !("marketCapSortValue" in q),
      )
    ) {
      return null;
    }
    if (
      data.quotes.some(
        (q) =>
          q &&
          typeof q === "object" &&
          (q as QuoteRow).market === "US" &&
          typeof (q as QuoteRow).marketCapText === "string" &&
          (q as QuoteRow).marketCapText!.includes("조"),
      )
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** TTL 무시: 네트워크 실패 시 마지막으로 성공한 시세만 표시할 때 사용 */
function readCacheStale(
  key: string,
): { quotes: QuoteRow[]; krwPerUsd: number } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      t: number;
      data: { quotes: QuoteRow[]; krwPerUsd: number };
    };
    const data = parsed.data;
    if (
      !Array.isArray(data.quotes) ||
      data.quotes.some(
        (q) =>
          !(q && typeof q === "object" && "marketCapText" in q) ||
          !("marketCapSortValue" in q),
      )
    ) {
      return null;
    }
    if (
      data.quotes.some(
        (q) =>
          q &&
          typeof q === "object" &&
          (q as QuoteRow).market === "US" &&
          typeof (q as QuoteRow).marketCapText === "string" &&
          (q as QuoteRow).marketCapText!.includes("조"),
      )
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function buildPlaceholderQuoteRows(
  stockSymbols: string[],
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
): QuoteRow[] {
  return stockSymbols.map((symbol) => ({
    symbol,
    nameKo: nameBySymbol.get(symbol) ?? symbol,
    market: marketBySymbol.get(symbol) ?? "KR",
    shortName: symbol,
    priceNative: Number.NaN,
    currency: marketBySymbol.get(symbol) === "US" ? "USD" : "KRW",
    changePct: null,
    marketCapText: null,
    marketCapSortValue: null,
  }));
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

const FINNHUB_MAX_RETRIES = 5;
const FINNHUB_BASE_BACKOFF_MS = 1_400;
/** 무료 플랜 429 완화: 종목 간·엔드포인트 간 간격 */
const FINNHUB_GAP_MS = 380;

async function finnhubFetchWithRetry(url: string): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < FINNHUB_MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    last = res;
    if (res.status !== 429) return res;
    const ra = res.headers.get("Retry-After");
    const sec = ra ? Number.parseInt(ra, 10) : NaN;
    const fromHeader =
      Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, 30_000) : null;
    const backoff = FINNHUB_BASE_BACKOFF_MS * (attempt + 1);
    await sleep(fromHeader ?? Math.min(backoff, 12_000));
  }
  return last as Response;
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

function marketCapFromNaverIntegration(j: NaverIntegration): string | null {
  const infos = j.totalInfos ?? [];
  const row = infos.find((x) => x.code === "marketValue");
  const v = row?.value?.trim();
  return v && v.length > 0 ? v : null;
}

function naverMarketCapStringToKrw(src: string): number | null {
  const s = src.replaceAll(/\s+/g, " ").trim();
  const joM = s.match(/([\d,]+)\s*조/);
  const eokM = s.match(/([\d,]+)\s*억/);
  if (!joM && !eokM) return null;
  let krw = 0;
  if (joM) {
    const jo = Number(joM[1].replaceAll(",", ""));
    if (Number.isFinite(jo)) krw += jo * 1e12;
  }
  if (eokM) {
    const eok = Number(eokM[1].replaceAll(",", ""));
    if (Number.isFinite(eok)) krw += eok * 1e8;
  }
  return Number.isFinite(krw) && krw > 0 ? krw : null;
}

/**
 * 네이버 시총: `1,730조 4,985억` → **조 정수만**(`1,730조`). 뒤의 억 구간은 표시·합산에서 제외.
 * `조`가 없고 `억`만 있으면 1조=10,000억으로 환산한 뒤 **내림**해 정수 조만 씀.
 */
function naverMarketCapRawToJoText(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const s = raw.replaceAll(/\s+/g, " ").trim();
  const joM = s.match(/([\d,]+)\s*조/);
  if (joM) {
    const joInt = Number(joM[1].replaceAll(",", ""));
    if (Number.isFinite(joInt) && joInt > 0) {
      return `${new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }).format(joInt)}조`;
    }
  }
  const eokM = s.match(/([\d,]+)\s*억/);
  if (eokM) {
    const eok = Number(eokM[1].replaceAll(",", ""));
    if (Number.isFinite(eok) && eok > 0) {
      const joFloored = Math.floor(eok / 10_000);
      return `${new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }).format(joFloored)}조`;
    }
  }
  return s;
}

/** 미국 시총: USD만 표기 (`$3.49T` 등). Intl compact는 로캘에 따라 단위가 달라질 수 있어 고정 규칙 사용. */
function formatMarketCapUsd(usd: number | undefined | null): string | null {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null;
  const piece = (value: number, div: number, suffix: string) =>
    `$${(value / div).toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    })}${suffix}`;
  if (usd >= 1e12) return piece(usd, 1e12, "T");
  if (usd >= 1e9) return piece(usd, 1e9, "B");
  if (usd >= 1e6) return piece(usd, 1e6, "M");
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

function finnhubMarketCapMillions(
  raw: number | string | undefined | null,
): number | undefined {
  if (raw == null) return undefined;
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : undefined;
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

async function enrichYahooMarketCapsFromQuoteSummary(
  quotes: QuoteRow[],
): Promise<void> {
  const need = quotes.filter(
    (r) => r.marketCapText == null && r.currency === "USD",
  );
  if (need.length === 0) return;

  await Promise.all(
    need.map(async (r) => {
      const path = `v10/finance/quoteSummary/${encodeURIComponent(r.symbol)}`;
      const modules = "summaryDetail";
      const url = import.meta.env.PROD
        ? `/api/yahoo?path=${encodeURIComponent(path)}&modules=${encodeURIComponent(modules)}`
        : `/yahoo/${path}?modules=${encodeURIComponent(modules)}`;
      try {
        const res = await fetch(url);
        if (res.status === 429 || res.status === 401) return;
        if (!res.ok) return;
        const data = (await res.json()) as YahooQuoteSummary;
        if (data.quoteSummary?.error) return;
        const raw =
          data.quoteSummary?.result?.[0]?.summaryDetail?.marketCap?.raw;
        const text =
          typeof raw === "number" && Number.isFinite(raw)
            ? formatMarketCapUsd(raw)
            : null;
        if (text) {
          r.marketCapText = text;
          r.marketCapSortValue = raw;
        }
      } catch {
        /* ignore */
      }
    }),
  );
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
): Promise<QuoteRow[]> {
  if (krYahooSymbols.length === 0) return [];

  const rows = await Promise.all(
    krYahooSymbols.map(async (yahooSym) => {
      const code = krCodeFromYahooSymbol(yahooSym);
      const [basicRes, integRes] = await Promise.all([
        fetch(`/naver/api/stock/${code}/basic`),
        fetch(`/naver/api/stock/${code}/integration`),
      ]);
      if (!basicRes.ok) {
        throw new Error(
          `네이버 금융 시세 실패 (${basicRes.status}) — 종목코드 ${code}`,
        );
      }
      const j = (await basicRes.json()) as NaverStockBasic;
      const price = parseNaverPriceKrw(j.closePrice);
      if (Number.isNaN(price) || price <= 0) {
        throw new Error(`네이버 금융: ${yahooSym} 가격을 읽지 못했습니다.`);
      }
      let marketCapText: string | null = null;
      let marketCapSortValue: number | null = null;
      if (integRes.ok) {
        try {
          const inte = (await integRes.json()) as NaverIntegration;
          const rawCap = marketCapFromNaverIntegration(inte);
          marketCapText = naverMarketCapRawToJoText(rawCap);
          marketCapSortValue = rawCap ? naverMarketCapStringToKrw(rawCap) : null;
        } catch {
          marketCapText = null;
          marketCapSortValue = null;
        }
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
        marketCapText,
        marketCapSortValue,
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
    const capRaw = q.marketCap ?? q.regularMarketMarketCap;
    const marketCapSortValue =
      typeof capRaw === "number" && Number.isFinite(capRaw) ? capRaw : null;
    const marketCapText =
      marketCapSortValue != null ? formatMarketCapUsd(marketCapSortValue) : null;
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
      marketCapText,
      marketCapSortValue,
    });
  }

  await enrichYahooMarketCapsFromQuoteSummary(quotes);

  const order = new Map(stockSymbols.map((s, i) => [s, i]));
  quotes.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));

  return quotes;
}

async function fetchQuotesYahoo(
  stockSymbols: string[],
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
): Promise<QuoteRow[]> {
  try {
    return await fetchYahooOnce(stockSymbols, nameBySymbol, marketBySymbol);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const retryable =
      m.includes("Yahoo Finance(미국 종목)") ||
      m.includes("시세 요청 실패 (429)") ||
      m.includes("시세 요청 실패 (401)");
    if (!retryable) throw e;
    await sleep(2200);
    return await fetchYahooOnce(stockSymbols, nameBySymbol, marketBySymbol);
  }
}

function finnhubPrice(q: FinnhubQuote): number | null {
  const c = q.c;
  const pc = q.pc;
  if (c != null && !Number.isNaN(c) && c > 0) return c;
  if (pc != null && !Number.isNaN(pc) && pc > 0) return pc;
  return null;
}

/** Finnhub 무료 플랜은 동시 호출·초당 한도에 민감해 429가 나기 쉽다. 종목·엔드포인트 순차 + 429 재시도. */
async function fetchQuotesFinnhubUs(
  usSymbols: string[],
  token: string,
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
): Promise<QuoteRow[]> {
  if (usSymbols.length === 0) return [];

  const quotes: QuoteRow[] = [];

  for (let i = 0; i < usSymbols.length; i++) {
    const symbol = usSymbols[i];
    const qs = new URLSearchParams({ symbol, token });

    const quoteRes = await finnhubFetchWithRetry(
      `/finnhub/api/v1/quote?${qs}`,
    );
    if (!quoteRes.ok) {
      const hint429 =
        quoteRes.status === 429
          ? " (무료 플랜 분당·초당 한도 초과일 수 있습니다. 잠시 뒤 다시 시도해 주세요.)"
          : "";
      const hint403 =
        quoteRes.status === 403
          ? " 무료 플랜은 미국 시장 시세만 허용되는 경우가 많습니다."
          : "";
      throw new Error(
        `Finnhub 시세 실패 (${quoteRes.status}). API 키·호출 한도를 확인해 주세요.${hint403}${hint429}`,
      );
    }
    const data = (await quoteRes.json()) as FinnhubQuote;
    const price = finnhubPrice(data);
    if (price == null) {
      throw new Error(`Finnhub: ${symbol} 가격을 읽지 못했습니다.`);
    }

    await sleep(FINNHUB_GAP_MS);

    const profRes = await finnhubFetchWithRetry(
      `/finnhub/api/v1/stock/profile2?${qs}`,
    );

    let marketCapText: string | null = null;
    let marketCapSortValue: number | null = null;
    if (profRes.ok) {
      try {
        const prof = (await profRes.json()) as FinnhubProfile;
        const millions = finnhubMarketCapMillions(prof.marketCapitalization);
        const usd =
          millions != null && Number.isFinite(millions) && millions > 0
            ? millions * 1_000_000
            : NaN;
        marketCapSortValue = Number.isFinite(usd) ? usd : null;
        marketCapText =
          marketCapSortValue != null
            ? formatMarketCapUsd(marketCapSortValue)
            : null;
      } catch {
        marketCapText = null;
        marketCapSortValue = null;
      }
    }

    const market = marketBySymbol.get(symbol) ?? "US";
    const currency = "USD";
    const dp = data.dp;
    const changePct =
      dp == null || Number.isNaN(dp) ? null : (dp as number);
    quotes.push({
      symbol,
      nameKo: nameBySymbol.get(symbol) ?? symbol,
      market,
      shortName: symbol,
      priceNative: price,
      currency,
      changePct,
      marketCapText,
      marketCapSortValue,
    });

    if (i < usSymbols.length - 1) {
      await sleep(FINNHUB_GAP_MS);
    }
  }

  const order = new Map(usSymbols.map((s, idx) => [s, idx]));
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

/** 같은 시장(한국/미국) 안에서 시총 내림차순. 시총 없음은 맨 뒤, 동률은 티커 순 */
export function compareQuoteRowsByMarketCapDesc(
  a: QuoteRow,
  b: QuoteRow,
): number {
  const va = a.marketCapSortValue;
  const vb = b.marketCapSortValue;
  if (va != null && vb != null && va !== vb) return vb - va;
  if (va != null && vb == null) return -1;
  if (va == null && vb != null) return 1;
  return a.symbol.localeCompare(b.symbol);
}

function isRateLimitedError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return (
    m.includes("429") ||
    m.includes("한도") ||
    m.includes("Too Many") ||
    /rate\s*limit/i.test(m)
  );
}

function userNoticeWhenNoLiveData(isRate: boolean, hasStale: boolean): string {
  if (hasStale) {
    return isRate
      ? "무료 API 호출 한도로 최신 시세를 가져오지 못했습니다. 아래는 직전에 조회에 성공했던 시세입니다. 약 1분 뒤 새로고침해 주세요."
      : "일시적인 문제로 최신 시세를 가져오지 못했습니다. 아래는 이전에 불러온 시세입니다. 잠시 후 새로고침해 주세요.";
  }
  return isRate
    ? "무료 API 호출 한도로 시세 조회가 어렵습니다. 약 1분 뒤 새로고침해 주세요."
    : "일시적으로 시세를 가져오지 못했습니다. 잠시 후 새로고침해 주세요.";
}

export async function fetchQuotes(
  stockSymbols: string[],
  nameBySymbol: Map<string, string>,
  marketBySymbol: Map<string, Market>,
): Promise<FetchQuotesResult> {
  const token = (import.meta.env.VITE_FINNHUB_API_KEY as string | undefined)
    ?.trim();
  const source: "finnhub_naver" | "naver_yahoo" = token
    ? "finnhub_naver"
    : "naver_yahoo";
  const ck = cacheKey(stockSymbols, source);
  const hit = readCache(ck);
  if (hit) {
    return { quotes: hit.quotes, krwPerUsd: hit.krwPerUsd, userNotice: null };
  }

  if (pendingFetch) return pendingFetch;

  pendingFetch = (async () => {
    let krwPerUsd = FALLBACK_KRW_PER_USD;
    try {
      krwPerUsd = await fetchKrwPerUsd();
    } catch {
      /* Frankfurter 실패 시에도 화면은 유지 */
    }

    try {
      const kr = stockSymbols.filter((s) => marketBySymbol.get(s) === "KR");
      const us = stockSymbols.filter((s) => marketBySymbol.get(s) === "US");

      const [krRows, usRows] = await Promise.all([
        kr.length
          ? fetchQuotesNaverKr(kr, nameBySymbol, marketBySymbol)
          : Promise.resolve([] as QuoteRow[]),
        us.length
          ? token
            ? fetchQuotesFinnhubUs(us, token, nameBySymbol, marketBySymbol)
            : fetchQuotesYahoo(us, nameBySymbol, marketBySymbol)
          : Promise.resolve([] as QuoteRow[]),
      ]);

      const quotes = mergeQuoteRows(stockSymbols, [...krRows, ...usRows]);

      if (quotes.length === 0) {
        throw new Error("empty");
      }

      const payload = { quotes, krwPerUsd };
      writeCache(ck, payload);
      return {
        quotes: payload.quotes,
        krwPerUsd: payload.krwPerUsd,
        userNotice: null,
      };
    } catch (e) {
      const rate = isRateLimitedError(e);
      const stale = readCacheStale(ck);
      if (stale && stale.quotes.length > 0) {
        return {
          quotes: stale.quotes,
          krwPerUsd:
            Number.isFinite(stale.krwPerUsd) && stale.krwPerUsd > 0
              ? stale.krwPerUsd
              : krwPerUsd,
          userNotice: userNoticeWhenNoLiveData(rate, true),
        };
      }
      return {
        quotes: buildPlaceholderQuoteRows(
          stockSymbols,
          nameBySymbol,
          marketBySymbol,
        ),
        krwPerUsd,
        userNotice: userNoticeWhenNoLiveData(rate, false),
      };
    }
  })()
    .catch(() => ({
      quotes: buildPlaceholderQuoteRows(
        stockSymbols,
        nameBySymbol,
        marketBySymbol,
      ),
      krwPerUsd: FALLBACK_KRW_PER_USD,
      userNotice: userNoticeWhenNoLiveData(false, false),
    }))
    .finally(() => {
      pendingFetch = null;
    });

  return pendingFetch;
}
