import { describe, it, expect } from 'vitest';
import { conditionRace, recordEdges, aggregate, formatReport, sparkline, type EdgeRow } from './edgeMining.js';
import type { RaceRecord } from './types.js';
import type { ScorableModel } from './score.js';

describe('conditionRace — 버킷 경계', () => {
  it('배당대(분위수 기반): 1.8 이하 강한본명 / 2.9 초과 혼전', () => {
    expect(conditionRace({ favWinOdds: 1.8, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).favOddsBand).toBe('fav<=1.8');
    expect(conditionRace({ favWinOdds: 3.0, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).favOddsBand).toBe('fav>2.9');
  });
  it('두수: 9 이하 / 10~11 / 12 이상', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 9, rcDist: 1200, favModelRank: 2 }).fieldBand).toBe('field<=9');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 12, rcDist: 1200, favModelRank: 2 }).fieldBand).toBe('field>=12');
  });
  it('거리: 1400 이하 단 / 1700 초과 장', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1400, favModelRank: 2 }).distBand).toBe('dist<=1400');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1800, favModelRank: 2 }).distBand).toBe('dist>1700');
  });
  it('불일치 강도: 인기1위가 모델 2등=약 / 4등 이상=강', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).disagreeStrength).toBe('dis2');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1200, favModelRank: 5 }).disagreeStrength).toBe('dis>=4');
  });
});

describe('recordEdges — 불일치 경주만 기록', () => {
  const model: ScorableModel = { kind: 'weights', weights: { r: 1 } };
  const hr = (name: string, r: number, winOdds: number, ord: number) =>
    ({ hrName: name, pthrNo: 0, ord, winOdds, rawScores: { r }, features: [] });

  it('모델top1≠인기top1이면 1행, 착순·라벨·분기 기록', () => {
    const race: RaceRecord = {
      raceDate: 20250115, meet: 1, rcNo: 1, rcDist: 1200,
      horses: [
        hr('A', 0.9, 5.0, 4),
        hr('B', 0.8, 1.5, 1),
        hr('C', 0.5, 3.0, 2),
        hr('D', 0.2, 8.0, 5),
      ],
    };
    const rows = recordEdges([race], model);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.modelPickOrd).toBe(4);
    expect(rows[0]!.favPickOrd).toBe(1);
    expect(rows[0]!.quarterKey).toBe('2025-Q1');
    expect(rows[0]!.labels.favOddsBand).toBe('fav<=1.8');
    expect(rows[0]!.labels.fieldBand).toBe('field<=9');
    expect(rows[0]!.labels.disagreeStrength).toBe('dis2');
  });

  it('모델top1=인기top1(일치)이면 제외', () => {
    const race: RaceRecord = {
      raceDate: 20250115, meet: 1, rcNo: 2, rcDist: 1200,
      horses: [hr('A', 0.9, 1.5, 1), hr('B', 0.5, 3.0, 2), hr('C', 0.2, 8.0, 3)],
    };
    expect(recordEdges([race], model)).toHaveLength(0);
  });
});

describe('aggregate — 분기 안정성 가드', () => {
  const labels = { favOddsBand: 'fav>2.9', fieldBand: 'field>=12', distBand: 'dist<=1400', disagreeStrength: 'dis>=4' };
  const quarterRows = (qk: string, n: number, modelWins: boolean): EdgeRow[] =>
    Array.from({ length: n }, () => ({
      quarterKey: qk, labels,
      modelPickOrd: modelWins ? 1 : 5,
      favPickOrd: modelWins ? 5 : 1,
    }));

  it('유효분기 충분 + 다수 양수 → 채택후보', () => {
    const rows = [
      ...quarterRows('2025-Q1', 12, true), ...quarterRows('2025-Q2', 12, true),
      ...quarterRows('2025-Q3', 12, true), ...quarterRows('2025-Q4', 12, true),
      ...quarterRows('2026-Q1', 12, false),
    ];
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 4, positiveRatio: 0.6, combos: false });
    const seg = stats.find((s) => s.segment === 'favOddsBand=fav>2.9')!;
    expect(seg.qualifyingQuarters).toBe(5);
    expect(seg.positiveQuarters).toBe(4);
    expect(seg.verdict).toBe('채택후보');
    expect(seg.pooledPlaceEdge).toBeGreaterThan(0);
  });

  it('유효분기 부족 → 보류', () => {
    const rows = [...quarterRows('2025-Q1', 12, true), ...quarterRows('2025-Q2', 12, true)];
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 4, positiveRatio: 0.6, combos: false });
    const seg = stats.find((s) => s.segment === 'favOddsBand=fav>2.9')!;
    expect(seg.verdict).toBe('보류');
  });

  it('표본 부족 분기는 유효분기서 제외', () => {
    const rows = [
      ...quarterRows('2025-Q1', 12, true), ...quarterRows('2025-Q2', 12, true),
      ...quarterRows('2025-Q3', 12, true), ...quarterRows('2025-Q4', 12, true),
      ...quarterRows('2026-Q1', 5, false),
    ];
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 4, positiveRatio: 0.6, combos: false });
    const seg = stats.find((s) => s.segment === 'favOddsBand=fav>2.9')!;
    expect(seg.qualifyingQuarters).toBe(4);
    expect(seg.positiveQuarters).toBe(4);
  });

  it('combos=true면 2차 조합 구간도 생성', () => {
    const rows = quarterRows('2025-Q1', 12, true);
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 1, positiveRatio: 0.6, combos: true });
    expect(stats.some((s) => s.segment === 'favOddsBand=fav>2.9 ∩ fieldBand=field>=12')).toBe(true);
  });
});

describe('Reporter', () => {
  it('sparkline: 표본부족=· / 양수=+ / 음수=−', () => {
    const quarters = [
      { key: '2025-Q1', n: 12, placeEdge: 0.1 },
      { key: '2025-Q2', n: 5, placeEdge: -0.2 },
      { key: '2025-Q3', n: 12, placeEdge: -0.05 },
    ];
    expect(sparkline(quarters, 10)).toBe('+ · −');
  });
  it('formatReport: 채택후보가 보류보다 먼저', () => {
    const stats = [
      { segment: 'X', totalN: 10, quarters: [], qualifyingQuarters: 1, positiveQuarters: 0, pooledWinEdge: 0, pooledTop2Edge: 0, pooledPlaceEdge: -0.1, verdict: '보류' as const },
      { segment: 'Y', totalN: 50, quarters: [], qualifyingQuarters: 6, positiveQuarters: 5, pooledWinEdge: 0.02, pooledTop2Edge: 0.03, pooledPlaceEdge: 0.04, verdict: '채택후보' as const },
    ];
    const out = formatReport(stats, 10);
    expect(out.indexOf('Y')).toBeLessThan(out.indexOf('X'));
  });
});
