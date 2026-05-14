import type { QuoteRow } from "./api";

export type MarketSummaryBullets = {
  /** "한국 시장:" 뒤에 붙는 본문 */
  korea: string;
  /** "미국 시장:" 뒤 */
  us: string;
  /** "환율 영향:" 뒤 */
  fx: string;
};

/** USD/KRW(원/달러) 전일 대비 변동률(%) 기준 — Frankfurter 직전 일자 대비 */
const FX_FLAT_ABS_PCT = 0.3;

const messages = {
  koreaNoData:
    "이 화면에 표시된 국내 종목의 등락 데이터가 부족해 당일 흐름을 판단하기 어렵습니다.",
  koreaSemiconductorStrong:
    "삼성전자와 SK하이닉스가 상대적으로 강세를 보이며, 반도체 중심의 상승 흐름이 나타납니다.",
  koreaStrong:
    "국내 대표 대형주 전반에서 상승 흐름이 우세합니다.",
  koreaWeak:
    "국내 대표 대형주 전반에 조정 압력이 나타나고 있습니다.",
  koreaMixed:
    "종목별 흐름이 엇갈리며, 전반적으로 혼조세를 보입니다.",

  usNoData:
    "이 화면에 표시된 미국 종목의 등락 데이터가 부족해 당일 흐름을 판단하기 어렵습니다.",
  usTechStrong:
    "AI·빅테크 관련 대형주가 상승을 주도하며 우호적인 흐름을 보입니다.",
  usTechWeak:
    "빅테크 중심으로 하락 압력이 커지며, 미국 대표 종목 평균 수익률이 부진합니다.",
  usMixed:
    "AI·빅테크 관련 종목은 보합권에 머물거나 종목별 차별화가 나타납니다.",

  fxNoData:
    "USD/KRW 환율 정보를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.",

  fxUp: (r: number) =>
    `기준 환율은 USD/KRW 약 ${r.toLocaleString("ko-KR")}원으로 오름세(달러 강세)입니다. 미국 주식 투자 시 환차익이 더해져 원화 환산 수익률이 한층 더 높아지는 효과를 기대할 수 있습니다.`,

  fxDown: (r: number) =>
    `기준 환율은 USD/KRW 약 ${r.toLocaleString("ko-KR")}원으로 내림세(원화 강세)입니다. 미국 주식에서 달러로 수익이 나더라도, 원화로 환산할 때 환율 하락분만큼 수익이 일부 줄어들 수 있으니 참고해 주세요.`,

  fxFlat: (r: number) =>
    `기준 환율은 USD/KRW 약 ${r.toLocaleString("ko-KR")}원으로 큰 변동 없이 안정적인 흐름입니다. 현재는 환율 효과보다는 개별 종목의 주가 등락이 미국 주식 원화 수익률에 더 직접적인 영향을 주고 있습니다.`,
} as const;

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
  krwChangePct: number | null,
): MarketSummaryBullets {
  const krAvg = meanOf(kr);
  const semiAvg = meanOf(kr.filter((r) => SEMI_KR.has(r.symbol)));
  const usAvg = meanOf(us);

  let korea: string;
  if (krAvg === null) {
    korea = messages.koreaNoData;
  } else if (
    semiAvg !== null &&
    semiAvg > krAvg + 0.12 &&
    semiAvg > 0.03
  ) {
    korea = messages.koreaSemiconductorStrong;
  } else if (krAvg >= 0.35) {
    korea = messages.koreaStrong;
  } else if (krAvg <= -0.35) {
    korea = messages.koreaWeak;
  } else {
    korea = messages.koreaMixed;
  }

  let usLine: string;
  if (usAvg === null) {
    usLine = messages.usNoData;
  } else if (usAvg >= 0.35) {
    usLine = messages.usTechStrong;
  } else if (usAvg <= -0.35) {
    usLine = messages.usTechWeak;
  } else {
    usLine = messages.usMixed;
  }

  let fx: string;
  if (krwPerUsd == null || krwPerUsd <= 0) {
    fx = messages.fxNoData;
  } else {
    const r = Math.round(krwPerUsd);
    const ch = krwChangePct;
    if (ch == null || Number.isNaN(ch)) {
      fx = messages.fxFlat(r);
    } else if (ch > FX_FLAT_ABS_PCT) {
      fx = messages.fxUp(r);
    } else if (ch < -FX_FLAT_ABS_PCT) {
      fx = messages.fxDown(r);
    } else {
      fx = messages.fxFlat(r);
    }
  }

  return { korea, us: usLine, fx };
}
