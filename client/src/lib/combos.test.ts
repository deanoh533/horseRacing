import { describe, it, expect } from 'vitest';
import { winningComboPayouts, boxResults, sumBoxPools, type BoxPool } from './combos';
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

describe('boxResults (예측 상위 4두 박스)', () => {
  // 착순 3→7→1, 위 combos 재사용 (복승 {3,7}=20.5, 삼복승 {1,3,7}=138.8)
  it('1·2착이 박스 안이면 복승 적중, 1·2·3착 모두 안이면 삼복승 적중 — 배당·수익 계산', () => {
    const r = boxResults([1, 3, 7, 9], [3, 7, 1], combos)!;
    expect(r.quinella).toEqual({ combos: 6, cost: 600, hit: true, odds: 20.5, payout: 2050, profit: 1450 });
    expect(r.trio).toEqual({ combos: 4, cost: 400, hit: true, odds: 138.8, payout: 13880, profit: 13480 });
  });
  it('3착만 박스 밖이면 복승만 적중, 삼복승은 구입액만큼 손해', () => {
    const r = boxResults([3, 7, 2, 9], [3, 7, 1], combos)!;
    expect(r.quinella.hit).toBe(true);
    expect(r.trio).toEqual({ combos: 4, cost: 400, hit: false, odds: null, payout: 0, profit: -400 });
  });
  it('2착이 박스 밖이면 둘 다 미적중', () => {
    const r = boxResults([3, 1, 2, 9], [3, 7, 1], combos)!;
    expect(r.quinella.hit).toBe(false);
    expect(r.quinella.profit).toBe(-600);
    expect(r.trio.hit).toBe(false);
  });
  it('적중했는데 배당이 아직 없으면 배당·수익은 null', () => {
    const r = boxResults([1, 3, 7, 9], [3, 7, 1], [])!;
    expect(r.quinella).toEqual({ combos: 6, cost: 600, hit: true, odds: null, payout: null, profit: null });
  });
  it('박스가 4두 미만이거나 착순이 2두 미만이면 null', () => {
    expect(boxResults([1, 3, 7], [3, 7, 1], combos)).toBeNull();
    expect(boxResults([1, 3, 7, 9], [3], combos)).toBeNull();
  });
  it('착순이 2두뿐이면 복승만 판정, 삼복승은 null', () => {
    const r = boxResults([1, 3, 7, 9], [3, 7], combos)!;
    expect(r.quinella.hit).toBe(true);
    expect(r.trio).toBeNull();
  });
  it('5두 이상이 들어와도 앞 4두만 박스', () => {
    const r = boxResults([2, 4, 5, 6, 3], [3, 7, 1], combos)!;
    expect(r.quinella.hit).toBe(false);
  });
});

describe('sumBoxPools (하루 결산)', () => {
  const p = (hit: boolean, cost: number, payout: number | null): BoxPool =>
    ({ combos: cost / 100, cost, hit, odds: payout == null ? null : payout / 100, payout: hit ? payout : 0, profit: payout == null && hit ? null : (hit ? payout! : 0) - cost });

  it('구입·환급·수익·회수율 합산, null(판정 불가) 제외', () => {
    const s = sumBoxPools([p(true, 600, 1230), p(false, 600, 0), null, p(true, 600, 840)]);
    expect(s).toEqual({ n: 3, hits: 2, pending: 0, cost: 1800, payout: 2070, profit: 270, roi: 2070 / 1800 });
  });
  it('적중했지만 배당 대기인 경주는 적중 수엔 넣고 금액 합계에선 뺀다', () => {
    const s = sumBoxPools([p(true, 400, null), p(false, 400, 0)]);
    expect(s).toEqual({ n: 2, hits: 1, pending: 1, cost: 400, payout: 0, profit: -400, roi: 0 });
  });
  it('대상이 없으면 n 0, 회수율 null', () => {
    expect(sumBoxPools([null, null])).toEqual({ n: 0, hits: 0, pending: 0, cost: 0, payout: 0, profit: 0, roi: null });
  });
});
