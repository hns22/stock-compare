import type { QuoteRow } from "./api";

export type MarketSummaryBullets = {
  /** "한국 시장:" 뒤에 붙는 본문 */
  korea: string;
  /** "미국 시장:" 뒤 */
  us: string;
  /** "환율 영향:" 뒤 */
  fx: string;
};

const SEMI_KR = new Set(["005930.KS", "000660.KS"]);

function pct(r: QuoteRow): number | null {
  const x = r.changePct;
  if (x == null || Number.isNaN(x)) return null;
  return x;
}

function meanOf(rows: QuoteRow[]): number | null {
  const xs = rows.map(pct).filter((n): n is number => n !== null);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * 화면에 있는 10개 종목의 당일 등락률·환율만으로 짧은 스냅샷 문구를 만듭니다.
 * (투자 권유·공식 시황이 아닙니다.)
 */
export function buildMarketSummaryBullets(
  kr: QuoteRow[],
  us: QuoteRow[],
  krwPerUsd: number | null,
): MarketSummaryBullets {
  const krAvg = meanOf(kr);
  const semiAvg = meanOf(kr.filter((r) => SEMI_KR.has(r.symbol)));
  const usAvg = meanOf(us);

  let korea: string;
  if (krAvg === null) {
    korea =
      "이 화면에 올라온 국내 종목의 등락률이 충분하지 않아 톤을 판단하기 어렵습니다.";
  } else if (
    semiAvg !== null &&
    semiAvg > krAvg + 0.12 &&
    semiAvg > 0.03
  ) {
    korea =
      "반도체(삼성전자·SK하이닉스)가 상대적으로 강한 반도체 중심 강세 흐름으로 읽힙니다.";
  } else if (krAvg >= 0.35) {
    korea = "국내 대형주 상승 분위기가 두드러집니다.";
  } else if (krAvg <= -0.35) {
    korea = "국내 대형주 조정·약세 압력이 상대적으로 큽니다.";
  } else {
    korea = "혼조 속에서 업종·종목별로 등락이 엇갈리는 모습입니다.";
  }

  let usLine: string;
  if (usAvg === null) {
    usLine =
      "미국 쪽 샘플 종목의 등락률이 충분하지 않아 톤을 판단하기 어렵습니다.";
  } else if (usAvg >= 0.35) {
    usLine =
      "AI·빅테크 중심 상승 국면으로 보이며, 대형 기술주 톤이 좋습니다.";
  } else if (usAvg <= -0.35) {
    usLine = "빅테크 약세로 샘플 종목 평균 하락 폭이 큽니다.";
  } else {
    usLine =
      "AI·빅테크 계열은 보합에 가깝거나 종목별로 희비가 갈립니다.";
  }

  let fx: string;
  if (krwPerUsd == null || krwPerUsd <= 0) {
    fx =
      "USD/KRW 기준을 불러오지 못했습니다. 새로고침 후 원화 환산 관련 해설을 확인할 수 있습니다.";
  } else {
    const r = Math.round(krwPerUsd);
    fx = `기준 USD/KRW 약 ${r.toLocaleString("ko-KR")}원 수준입니다. 원화 약세(달러 강세)가 이어지면 같은 달러 수익이라도 원화로 환산한 미국 주식 수익률은 커지기 쉽고, 원화 강세이면 원화 환산 수익은 상대적으로 줄어드는 방향입니다.`;
  }

  return { korea, us: usLine, fx };
}
