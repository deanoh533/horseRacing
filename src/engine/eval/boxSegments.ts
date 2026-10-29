/**
 * 4두 박스 구간별 회수율 사전등록 판정 — 스펙 docs/superpowers/specs/2026-10-29-box-segment-prereg.md. 순수.
 * 구간 경계·판정 규칙은 결과 보기 전(2026-10-29)에 고정. 사후 변경 금지.
 */

export const BOX_SEG_RULE = {
  favCuts: [1.8, 3.0] as const, // 인기 1위 확정 단승: ≤1.8 강함 · (1.8, 3.0) 보통 · ≥3.0 혼전
  confCuts: [0.246, 0.338] as const, // 모델 1순위 p_win: 2026-08~10 3등분 경계
};

export type FavSeg = 'strong' | 'normal' | 'open';
export type ConfSeg = 'low' | 'mid' | 'high';

export interface SegTally { races: number; hits: number; cost: number; payout: number; }

export function favSegment(favOdds: number): FavSeg {
  const [lo, hi] = BOX_SEG_RULE.favCuts;
  return favOdds <= lo ? 'strong' : favOdds < hi ? 'normal' : 'open';
}

export function confSegment(topPWin: number): ConfSeg {
  const [lo, hi] = BOX_SEG_RULE.confCuts;
  return topPWin < lo ? 'low' : topPWin < hi ? 'mid' : 'high';
}

const roi = (t: SegTally): number | null => (t.cost > 0 ? t.payout / t.cost : null);
const pooled = (ts: SegTally[]): number | null => {
  const cost = ts.reduce((s, t) => s + t.cost, 0);
  return cost > 0 ? ts.reduce((s, t) => s + t.payout, 0) / cost : null;
};
/** a가 나머지 전부보다 회수율이 높은가 (경주 없는 구간이 끼면 false) */
const beatsAll = (a: number | null, others: Array<number | null>): boolean =>
  a != null && others.every((o) => o != null && a > o);

/**
 * 복승 4두 박스 기준.
 * H1(시장): 보통 구간 회수율 > 전체 · 강함 · 혼전.
 * H2(모델): 중간 확신 구간 회수율 > 전체 · 높음.
 */
export function judgeBoxSegments(q: { fav: Record<FavSeg, SegTally>; conf: Record<ConfSeg, SegTally> }) {
  const { h1, overall: overallFav } = judgeFavH1(q.fav);
  const overallConf = pooled(Object.values(q.conf));
  const h2 = beatsAll(roi(q.conf.mid), [overallConf, roi(q.conf.high)]);
  return { h1, h2, overallFav, overallConf };
}

/** H1만 — 스펙 §7 과거 데이터 확인(모델 확신 구간 없이 인기마 강약만 있을 때). */
export function judgeFavH1(fav: Record<FavSeg, SegTally>) {
  const overall = pooled(Object.values(fav));
  return { h1: beatsAll(roi(fav.normal), [overall, roi(fav.strong), roi(fav.open)]), overall };
}
