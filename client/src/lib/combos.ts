import type { ComboDividend } from './supabase';

/** 대상 pool 라벨 (표시용) */
export const POOL_LABELS: Record<string, string> = {
  복승식: '복승',
  쌍승식: '쌍승',
  복연승식: '복연승',
  삼복승식: '삼복승',
  삼쌍승식: '삼쌍승',
};

/** 순서가 착순 의미인 pool (leg 순서 그대로 매칭) */
const ORDERED = new Set(['쌍승식', '삼쌍승식']);

export interface WinningCombo {
  pool: string;
  legs: number[];
  odds: number;
}

/** 조합의 leg 배열 (leg3=0이면 2마리) */
function legsOf(c: ComboDividend): number[] {
  return c.leg3 ? [c.leg1, c.leg2, c.leg3] : [c.leg1, c.leg2];
}

/**
 * 착순 게이트(top1~3, 순서=착순) + 조합목록 → pool별 적중 조합 배당.
 * gates 길이 2면 복승·쌍승만, 3이면 전부. 반환 순서: 복승→쌍승→복연승(≤3)→삼복승→삼쌍승.
 * 순서無(복승·복연승·삼복승)은 집합 매칭, 순서有(쌍승·삼쌍승)은 순서 매칭.
 */
export function winningComboPayouts(combos: ComboDividend[], gates: number[]): WinningCombo[] {
  const byPool = new Map<string, ComboDividend[]>();
  for (const c of combos) {
    if (!byPool.has(c.pool)) byPool.set(c.pool, []);
    byPool.get(c.pool)!.push(c);
  }

  const matchSet = (pool: string, wanted: number[]): ComboDividend | undefined => {
    const key = [...wanted].sort((a, b) => a - b).join(',');
    return (byPool.get(pool) ?? []).find(
      (c) => legsOf(c).slice().sort((a, b) => a - b).join(',') === key
    );
  };
  const matchOrdered = (pool: string, wanted: number[]): ComboDividend | undefined =>
    (byPool.get(pool) ?? []).find((c) => legsOf(c).join(',') === wanted.join(','));

  const out: WinningCombo[] = [];
  const add = (pool: string, wanted: number[]) => {
    const m = ORDERED.has(pool) ? matchOrdered(pool, wanted) : matchSet(pool, wanted);
    if (m) out.push({ pool, legs: wanted, odds: m.odds });
  };

  const [g1, g2, g3] = gates;
  if (g1 != null && g2 != null) {
    add('복승식', [g1, g2]);
    add('쌍승식', [g1, g2]);
  }
  if (g1 != null && g2 != null && g3 != null) {
    for (const pair of [[g1, g2], [g1, g3], [g2, g3]] as number[][]) {
      add('복연승식', pair);
    }
    add('삼복승식', [g1, g2, g3]);
    add('삼쌍승식', [g1, g2, g3]);
  }
  return out;
}
