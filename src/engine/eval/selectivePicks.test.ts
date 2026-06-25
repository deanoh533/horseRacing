// src/engine/eval/selectivePicks.test.ts
import { describe, it, expect } from 'vitest';
import {
  classifyTier, buildSelectionCurve, tierAccuracy, pickThreshold,
  type PredRow,
} from './selectivePicks.js';

const row = (p_top3: number | null, actual_ord: number | null, rc = 1, p_win = 0.1): PredRow =>
  ({ race_date: 20260101, meet: 1, rc_no: rc, p_top3, p_win, actual_ord });

describe('classifyTier', () => {
  it('강추/주목/null 경계', () => {
    expect(classifyTier(0.9, 0.8, 0.6)).toBe('strong');
    expect(classifyTier(0.8, 0.8, 0.6)).toBe('strong'); // 경계 포함
    expect(classifyTier(0.7, 0.8, 0.6)).toBe('watch');
    expect(classifyTier(0.6, 0.8, 0.6)).toBe('watch');  // 경계 포함
    expect(classifyTier(0.5, 0.8, 0.6)).toBe(null);
    expect(classifyTier(null, 0.8, 0.6)).toBe(null);
  });
  it('minProb<=0 비활성', () => {
    expect(classifyTier(0.99, 0, 0)).toBe(null);
    expect(classifyTier(0.99, 0, 0.6)).toBe('watch'); // 강추만 비활성
  });
});

describe('buildSelectionCurve', () => {
  const rows: PredRow[] = [
    row(0.9, 1, 1), row(0.7, 4, 1),   // 경주1: 한 마리 적중(1착), 한 마리 탈락
    row(0.85, 2, 2), row(0.5, 5, 2),  // 경주2
  ];
  it('임계값별 적중률·커버리지·베이스라인', () => {
    const c = buildSelectionCurve(rows, [0.8, 0.6]);
    expect(c.totalRows).toBe(4);
    expect(c.totalRaces).toBe(2);
    // 베이스라인 연승(1~3착): 0.9→1착O, 0.7→4착X, 0.85→2착O, 0.5→5착X = 2/4
    expect(c.baselinePlace).toBeCloseTo(0.5);
    expect(c.baselineWin).toBeCloseTo(0.25); // 1착 1건/4
    const at08 = c.points.find((p) => p.threshold === 0.8)!;
    expect(at08.picks).toBe(2);             // 0.9, 0.85
    expect(at08.placeHitRate).toBeCloseTo(1.0); // 둘 다 3착내
    expect(at08.coverage).toBeCloseTo(1.0);  // 두 경주 모두 픽 존재
  });
});

describe('tierAccuracy', () => {
  it('주목은 [watchMin, strongMin) 배타 구간', () => {
    const rows: PredRow[] = [row(0.9, 1, 1), row(0.7, 2, 2), row(0.5, 4, 3)];
    const [strong, watch] = tierAccuracy(rows, 0.8, 0.6);
    expect(strong.picks).toBe(1);   // 0.9
    expect(watch.picks).toBe(1);    // 0.7 (0.5는 제외)
    expect(strong.placeHitRate).toBeCloseTo(1.0);
  });
});

describe('pickThreshold', () => {
  it('목표 적중률을 만족하는 최저 임계값', () => {
    const rows: PredRow[] = [row(0.9, 1), row(0.8, 2), row(0.7, 5), row(0.6, 6)];
    const c = buildSelectionCurve(rows, [0.6, 0.7, 0.8, 0.9]);
    // 0.8 이상: 0.9(1착),0.8(2착) → 1.0 ; 0.7 이상: +0.7(5착X) → 2/3
    expect(pickThreshold(c, 0.9)).toBe(0.8);
    expect(pickThreshold(c, 1.1)).toBe(null);
  });
});
