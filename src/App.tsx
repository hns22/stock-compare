import { useCallback, useEffect, useMemo, useState } from "react";
import { STOCKS, type Market } from "./stocks";
import { fetchQuotes, type QuoteRow } from "./api";
import { buildMarketSummaryBullets } from "./marketSummary";
import "./App.css";

function formatMoney(n: number, currency: string, maxFrac = 2): string {
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
            <th className="num">USD 환산</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>
                <div>{r.nameKo}</div>
                <div className="sym">{r.shortName}</div>
                <div className="sym">{r.symbol}</div>
              </td>
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
              <td className="num">{formatMoney(r.priceUsd, "USD")}</td>
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
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

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
    setError(null);
    try {
      const symbols = STOCKS.map((s) => s.symbol);
      const { quotes, krwPerUsd: rate } = await fetchQuotes(
        symbols,
        nameBySymbol,
        marketBySymbol,
      );
      setRows(quotes);
      setKrwPerUsd(rate);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setRows([]);
      setKrwPerUsd(null);
    } finally {
      setLoading(false);
    }
  }, [nameBySymbol, marketBySymbol]);

  useEffect(() => {
    void load();
  }, [load]);

  const krRows = rows.filter((r) => r.market === "KR");
  const usRows = rows.filter((r) => r.market === "US");

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

        {loading && rows.length === 0 && !error ? (
          <ul className="summary-bullets summary-bullets--skeleton" aria-busy="true">
            <li className="skel">한국 시장 요약을 준비하는 중…</li>
            <li className="skel">미국 시장 요약을 준비하는 중…</li>
            <li className="skel">환율 영향 설명을 준비하는 중…</li>
          </ul>
        ) : error ? (
          <p className="summary-error">
            시세를 불러오지 못해 요약을 표시할 수 없습니다. 위쪽 오류를 확인한 뒤
            새로고침해 주세요.
          </p>
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
          한국과 미국의 주요 10개 대표 종목 시세를 한 화면에서 비교할 수 있는
          대시보드입니다.
          <br />
          원화로 표시되는 한국 종목은 USD/KRW 환율을 적용해 달러 환산가를 함께
          제공합니다.
          <br />
          데이터 출처: 한국 종목 – 네이버 금융, 미국 종목 – Finnhub · Yahoo Finance,
          환율 – Frankfurter API
        </p>
      </header>

      <div className="toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => window.location.reload()}
        >
          새로고침
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

      {error && <div className="error">{error}</div>}

      {loading && rows.length === 0 && !error && (
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
              위 10개 종목 중 당일 <strong>상승(+)</strong>한 종목만 등락률 높은
              순으로 최대 3곳입니다.
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
                      <div className="rank-meta sym">
                        {r.symbol} · {r.shortName}
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
