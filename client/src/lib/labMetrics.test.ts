import { describe, it, expect } from 'vitest';
import { raceHits, pairedNoise, buildScoreboard, buildRaceComparisons, type LabRow } from './labMetrics';

const mk = (v: number, date: number, rc: number, picks: [string, number, number | null][]): LabRow[] =>
  picks.map(([hr, rank, ord]) => ({ race_date: date, meet: 1, rc_no: rc, hr_name: hr, predicted_rank: rank, actual_ord: ord, model_version: v }));

describe('raceHits', () => {
  it('단승·연승·복승(순서무관)·TOP3 겹침', () => {
    const h = raceHits(mk(7, 1, 1, [['A', 1, 2], ['B', 2, 1], ['C', 3, 5], ['D', 4, 3]]))!;
    expect(h).toEqual({ win: false, place: true, quinella: true, top3Overlap: 2 });
  });
  it('결과 없는 경주는 null', () => {
    expect(raceHits(mk(7, 1, 1, [['A', 1, null], ['B', 2, null]]))).toBeNull();
  });
  it('1순위 말 결과 null(출전취소)은 적중 아님', () => {
    const h = raceHits(mk(7, 1, 1, [['A', 1, null], ['B', 2, 1], ['C', 3, 2]]))!;
    expect(h.place).toBe(false);
    expect(h.quinella).toBe(false);
  });
});

describe('pairedNoise', () => {
  it('엇갈림이 없으면 폭 0', () => {
    expect(pairedNoise([true, false], [true, false])).toEqual({ delta: 0, band: 0 });
  });
  it('섀도만 맞힌 경주가 많으면 +Δ, 폭은 양수', () => {
    const live = [false, false, true, true], sh = [true, true, true, true];
    const r = pairedNoise(live, sh);
    expect(r.delta).toBeCloseTo(0.5);
    expect(r.band).toBeGreaterThan(0);
  });
});

describe('buildScoreboard', () => {
  it('섀도는 공통 경주만 집계하고 라이브 대비 Δ를 낸다', () => {
    const live = [...mk(7, 1, 1, [['A', 1, 1], ['B', 2, 2]]), ...mk(7, 1, 2, [['C', 1, 9], ['D', 2, 1]])];
    const shadow = mk(9, 1, 2, [['D', 1, 1], ['C', 2, 9]]); // 2경주 중 1경주만 존재
    const sb = buildScoreboard(live, shadow, 7);
    expect(sb[0]).toMatchObject({ version: 7, races: 2, placeDelta: null });
    expect(sb[1]).toMatchObject({ version: 9, races: 1, place: 1 });
    expect(sb[1]!.placeDelta).toBeCloseTo(1); // 공통 경주(rc2)에서 라이브 0 → 섀도 1
  });
});

describe('buildRaceComparisons', () => {
  it('1순위가 다르면 disagree, 최신 경주가 먼저', () => {
    const live = [...mk(7, 1, 1, [['A', 1, 1]]), ...mk(7, 2, 1, [['B', 1, 1]])];
    const shadow = [...mk(9, 1, 1, [['A', 1, 1]]), ...mk(9, 2, 1, [['C', 1, 2]])];
    const rc = buildRaceComparisons(live, shadow);
    expect(rc[0]!.race_date).toBe(2);
    expect(rc[0]!.disagree).toBe(true);
    expect(rc[1]!.disagree).toBe(false);
    expect(rc[0]!.picks[9]).toEqual(['C']);
  });
});
