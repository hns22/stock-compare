import { useCallback, useEffect, useMemo, useState } from "react";
import { STOCKS, type Market } from "./stocks";
import { fetchQuotes, type QuoteRow, compareQuoteRowsByMarketCapDesc } from "./api";
import { buildMarketSummaryBullets } from "./marketSummary";
import "./App.css";

/** 수동 새로고침 연타 시 무료 API 한도 방지(초) */
const MANUAL_REFRESH_COOLDOWN_SEC = 60;

function formatMoney(n: number, currency: string, maxFrac = 2): string {
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency,
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n.toFixed(maxFrac)} ${currency}`;
  }
}

function formatPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function Panel({
  title,
  market,
  rows,
}: {
  title: string;
  market: Market;
  rows: QuoteRow[];
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className={`badge ${market === "KR" ? "kr" : "us"}`} />
        {title}
      </div>
      <table>
        <thead>
          <tr>
            <th>종목</th>
            <th className="num">현재가</th>
            <th className="num">등락</th>
            <th className="num">
              {market === "KR" ? "시가총액(KRW)" : "시가총액(USD)"}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>{r.nameKo}</td>
              <td className="num">{formatMoney(r.priceNative, r.currency)}</td>
              <td
                className={`num ${
                  r.changePct == null
                    ? ""
                    : r.changePct >= 0
                      ? "change-up"
                      : "change-down"
                }`}
              >
                {formatPct(r.changePct)}
              </td>
              <td className="num">{r.marketCapText ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [krwPerUsd, setKrwPerUsd] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [userNotice, setUserNotice] = useState<string | null>(null);
  const [refreshCooldownSec, setRefreshCooldownSec] = useState(0);

  const nameBySymbol = useMemo(
    () => new Map(STOCKS.map((s) => [s.symbol, s.nameKo])),
    [],
  );
  const marketBySymbol = useMemo(
    () => new Map(STOCKS.map((s) => [s.symbol, s.market])),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setUserNotice(null);
    try {
      const symbols = STOCKS.map((s) => s.symbol);
      const { quotes, krwPerUsd: rate, userNotice: notice } = await fetchQuotes(
        symbols,
        nameBySymbol,
        marketBySymbol,
      );
      setRows(quotes);
      setKrwPerUsd(rate);
      setUserNotice(notice);
      if (quotes.some((r) => Number.isFinite(r.priceNative))) {
        setUpdatedAt(new Date());
      }
    } finally {
      setLoading(false);
    }
  }, [nameBySymbol, marketBySymbol]);

  useEffect(() => {
    if (refreshCooldownSec <= 0) return;
    const id = window.setTimeout(() => {
      setRefreshCooldownSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [refreshCooldownSec]);

  const handleManualRefresh = useCallback(() => {
    if (loading || refreshCooldownSec > 0) return;
    setRefreshCooldownSec(MANUAL_REFRESH_COOLDOWN_SEC);
    void load();
  }, [loading, refreshCooldownSec, load]);

  useEffect(() => {
    void load();
  }, [load]);

  const krRows = useMemo(
    () =>
      [...rows.filter((r) => r.market === "KR")].sort(
        compareQuoteRowsByMarketCapDesc,
      ),
    [rows],
  );
  const usRows = useMemo(
    () =>
      [...rows.filter((r) => r.market === "US")].sort(
        compareQuoteRowsByMarketCapDesc,
      ),
    [rows],
  );

  /** 당일 등락률(%) 기준 상승분만 — 상위 3 */
  const gainRankTop3 = useMemo(() => {
    const withPct = rows.filter(
      (r) => r.changePct != null && !Number.isNaN(r.changePct),
    );
    const risers = withPct.filter((r) => (r.changePct as number) > 0);
    return [...risers]
      .sort((a, b) => (b.changePct as number) - (a.changePct as number))
      .slice(0, 3);
  }, [rows]);

  const summaryBullets = useMemo(
    () => buildMarketSummaryBullets(krRows, usRows, krwPerUsd),
    [krRows, usRows, krwPerUsd],
  );

  return (
    <div className="app">
      <section className="summary-card" aria-labelledby="summary-heading">
        <div className="summary-card-top">
          <h2 id="summary-heading" className="summary-title">
            오늘의 시장 요약
          </h2>
          {updatedAt && rows.length > 0 && (
            <span className="summary-asof">
              기준{" "}
              {updatedAt.toLocaleString("ko-KR", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <p className="summary-lede">
          한·미 10개 종목의 당일 등락률과 USD/KRW 환율을 기준으로 작성한 간단한
          시장 요약입니다. 투자 권유나 공식 시황 자료가 아닙니다.
        </p>

        {loading && rows.length === 0 ? (
          <ul className="summary-bullets summary-bullets--skeleton" aria-busy="true">
            <li className="skel">한국 시장 요약을 준비하는 중…</li>
            <li className="skel">미국 시장 요약을 준비하는 중…</li>
            <li className="skel">환율 영향 설명을 준비하는 중…</li>
          </ul>
        ) : rows.length > 0 ? (
          <ul className="summary-bullets">
            <li>
              <span className="summary-topic">한국 시장</span>
              <span className="summary-body">{summaryBullets.korea}</span>
            </li>
            <li>
              <span className="summary-topic">미국 시장</span>
              <span className="summary-body">{summaryBullets.us}</span>
            </li>
            <li>
              <span className="summary-topic">환율 영향</span>
              <span className="summary-body">{summaryBullets.fx}</span>
            </li>
          </ul>
        ) : null}
      </section>

      <header className="header">
        <h1>한·미 대표 기업 주가 비교</h1>
        <p>
          한국과 미국의 주요 10개 기업 시세를 한 화면에서 비교할 수 있는
          대시보드입니다.
          <br />
          데이터 출처: 한국 종목 – 네이버 금융, 미국 종목 – Finnhub · Yahoo Finance,
          환율 – Frankfurter API
        </p>
      </header>

      {userNotice ? (
        <p className="notice-banner" role="status">
          {userNotice}
        </p>
      ) : null}

      <div className="toolbar">
        <button
          type="button"
          className="btn"
          disabled={loading || refreshCooldownSec > 0}
          onClick={handleManualRefresh}
        >
          {refreshCooldownSec > 0
            ? `다음 갱신 ${refreshCooldownSec}초 후`
            : "새로고침"}
        </button>
        {updatedAt && (
          <span className="meta">
            마지막 갱신:{" "}
            {updatedAt.toLocaleString("ko-KR", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {krwPerUsd != null &&
              ` · USD/KRW 약 ${krwPerUsd.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`}
          </span>
        )}
      </div>

      {loading && rows.length === 0 && (
        <p className="skel">시세를 불러오는 중입니다…</p>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="grid">
            <Panel title="한국 (KRX)" market="KR" rows={krRows} />
            <Panel title="미국 (NYSE / NASDAQ)" market="US" rows={usRows} />
          </div>

          <section className="rank-section" aria-labelledby="rank-heading">
            <h2 id="rank-heading">오늘의 상승률 TOP 3</h2>
            <p className="rank-hint">
              위 10개 종목 중 당일 상승(+)한 종목만 등락률 높은 순으로 상위 3개 종목을 보여줍니다.
            </p>
            {gainRankTop3.length === 0 ? (
              <p className="rank-empty">
                상승한 종목이 없거나 등락률 데이터가 없습니다.
              </p>
            ) : (
              <ol className="rank-list">
                {gainRankTop3.map((r, i) => (
                  <li key={r.symbol} className="rank-item">
                    <span className={`rank-medal rank-${i + 1}`}>{i + 1}</span>
                    <div className="rank-body">
                      <div className="rank-title">
                        <strong>{r.nameKo}</strong>
                        <span className="rank-market">
                          {r.market === "KR" ? "한국" : "미국"}
                        </span>
                      </div>
                    </div>
                    <div className="rank-tail">
                      <span className="rank-pct change-up">
                        {formatPct(r.changePct)}
                      </span>
                      <span className="rank-price num">
                        {formatMoney(r.priceNative, r.currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      <p className="footnote footnote--credit">
        Made by HNS · Built with Cursor
      </p>
    </div>
  );
}
