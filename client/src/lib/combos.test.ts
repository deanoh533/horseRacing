import { describe, it, expect } from 'vitest';
import { winningComboPayouts } from './combos';
import type { ComboDividend } from './supabase';

function c(pool: string, leg1: number, leg2: number, leg3: number, odds: number): ComboDividend {
  return { race_date: 20260726, meet: 1, rc_no: 1, pool, leg1, leg2, leg3, odds };
}

// 착순 1·2·3위 게이트 = 3, 7, 1
const combos: ComboDividend[] = [
  c('복승식', 3, 7, 0, 20.5),      // {3,7} 저장(오름차순 아님 케이스도 매칭돼야)
  c('쌍승식', 3, 7, 0, 41.1),      // (3→7)
  c('쌍승식', 7, 3, 0, 99.9),      // (7→3) — 적중 아님(순서 반대)
  c('복연승식', 3, 7, 0, 3.0),
  c('복연승식', 1, 3, 0, 1.8),
  c('복연승식', 1, 7, 0, 2.2),
  c('삼복승식', 1, 3, 7, 138.8),   // {1,3,7}
  c('삼쌍승식', 3, 7, 1, 1070.5),  // (3→7→1)
  c('단승식', 3, 0, 0, 5.0),       // 비대상
];

describe('winningComboPayouts', () => {
  it('복승은 집합 매칭(순서 무관)으로 적중 배당을 찾는다', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    const bok = r.find((x) => x.pool === '복승식');
    expect(bok?.odds).toBe(20.5);
  });

  it('쌍승은 순서 그대로 매칭한다(반대 순서는 제외)', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    const ssang = r.filter((x) => x.pool === '쌍승식');
    expect(ssang).toHaveLength(1);
    expect(ssang[0]!.odds).toBe(41.1);
  });

  it('복연승은 3착내 2마리 조합 3줄을 반환한다', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    const yeon = r.filter((x) => x.pool === '복연승식');
    expect(yeon).toHaveLength(3);
    expect(yeon.map((x) => x.odds).sort()).toEqual([1.8, 2.2, 3.0]);
  });

  it('삼복승은 집합, 삼쌍승은 순서로 매칭한다', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    expect(r.find((x) => x.pool === '삼복승식')?.odds).toBe(138.8);
    expect(r.find((x) => x.pool === '삼쌍승식')?.odds).toBe(1070.5);
  });

  it('결과 순서는 복승→쌍승→복연승→삼복승→삼쌍승', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    expect(r.map((x) => x.pool)).toEqual([
      '복승식', '쌍승식', '복연승식', '복연승식', '복연승식', '삼복승식', '삼쌍승식',
    ]);
  });

  it('착순이 top2만 있으면 복승·쌍승만 반환한다', () => {
    const r = winningComboPayouts(combos, [3, 7]);
    expect(r.map((x) => x.pool)).toEqual(['복승식', '쌍승식']);
  });

  it('적중 조합이 목록에 없으면 그 pool 줄을 생략한다', () => {
    const only = [c('복승식', 3, 7, 0, 20.5)];
    const r = winningComboPayouts(only, [3, 7, 1]);
    expect(r.map((x) => x.pool)).toEqual(['복승식']);
  });
});
