// src/engine/eval/v7Accuracy.test.ts
import { describe, it, expect } from 'vitest';
import {
  joinResults, computeTiers, computeTiersByVersion,
  type PredictionSlim, type ResultSlim,
} from './v7Accuracy.js';

const pred = (
  p_top3: number | null, rc = 1, hr = '말1', model_version: number | null = 7,
): PredictionSlim => ({ race_date: 20260712, meet: 1, rc_no: rc, hr_name: hr, p_top3, model_version });

const result = (ord: number | null, rc = 1, hr = '말1'): ResultSlim =>
  ({ race_date: 20260712, meet: 1, rc_no: rc, hr_name: hr, ord });

describe('joinResults', () => {
  it('race_entries.ord가 있으면 actual_ord로 매핑', () => {
    const [row] = joinResults([pred(0.8)], [result(2)]);
    expect(row!.actual_ord).toBe(2);
    expect(row!.p_top3).toBe(0.8);
    expect(row!.model_version).toBe(7);
  });

  it('매칭되는 race_entries 행이 없으면(결과 미도착) actual_ord=null', () => {
    const [row] = joinResults([pred(0.8)], []);
    expect(row!.actual_ord).toBeNull();
  });

  it('race_entries.ord가 NULL(실격 등)이어도 actual_ord=null', () => {
    const [row] = joinResults([pred(0.8)], [result(null)]);
    expect(row!.actual_ord).toBeNull();
  });

  it('경주·말 키가 다르면 조인되지 않음', () => {
    const [row] = joinResults([pred(0.8, 1, '말1')], [result(2, 1, '말2')]);
    expect(row!.actual_ord).toBeNull();
  });
});

describe('computeTiers', () => {
  it('강추/주목/전체 카테고리별 적중(연승=3착내) 집계', () => {
    const rows = joinResults(
      [
        pred(0.9, 1), pred(0.75, 2), // 강추 2건 (>=0.72)
        pred(0.65, 3), pred(0.63, 4), // 주목 2건 ([0.62, 0.72))
        pred(0.4, 5), // 미포함(전체에는 들어감)
      ],
      [
        result(1, 1), result(4, 2), // 강추: 1적중/2
        result(2, 3), result(5, 4), // 주목: 1적중/2
        result(3, 5), // 저확률도 3착내 적중
      ],
    );
    const tiers = computeTiers(rows, 0.72, 0.62);
    const strong = tiers.find((t) => t.category === '강추')!;
    const watch = tiers.find((t) => t.category === '주목')!;
    const all = tiers.find((t) => t.category === '전체')!;

    expect(strong.total).toBe(2);
    expect(strong.correct).toBe(1);
    expect(strong.accuracy).toBeCloseTo(50.0);

    expect(watch.total).toBe(2);
    expect(watch.correct).toBe(1);
    expect(watch.accuracy).toBeCloseTo(50.0);

    expect(all.total).toBe(5);
    expect(all.correct).toBe(3); // 1착, 2착, 3착 세 건
    expect(all.accuracy).toBeCloseTo(60.0);
  });

  it('결과 미도착(actual_ord=null) 행은 모든 카테고리에서 제외', () => {
    const rows = joinResults([pred(0.9, 1), pred(0.9, 2)], [result(1, 1)]); // 2번은 결과 미도착
    const tiers = computeTiers(rows, 0.72, 0.62);
    const strong = tiers.find((t) => t.category === '강추')!;
    const all = tiers.find((t) => t.category === '전체')!;
    expect(strong.total).toBe(1);
    expect(all.total).toBe(1);
  });

  it('총건수 0이면 accuracy=0 (0으로 나누기 방지)', () => {
    const tiers = computeTiers([], 0.72, 0.62);
    for (const t of tiers) {
      expect(t.total).toBe(0);
      expect(t.correct).toBe(0);
      expect(t.accuracy).toBe(0);
    }
  });
});

describe('computeTiersByVersion', () => {
  it('model_version별로 분리 집계', () => {
    const rows = joinResults(
      [pred(0.9, 1, '말1', 7), pred(0.9, 2, '말1', 6)],
      [result(1, 1, '말1'), result(4, 2, '말1')],
    );
    const byVersion = computeTiersByVersion(rows, 0.72, 0.62);
    expect(byVersion).toHaveLength(2);
    const v7 = byVersion.find((v) => v.modelVersion === 7)!;
    const v6 = byVersion.find((v) => v.modelVersion === 6)!;
    expect(v7.tiers.find((t) => t.category === '전체')!.correct).toBe(1);
    expect(v6.tiers.find((t) => t.category === '전체')!.correct).toBe(0);
  });

  it('model_version=null(v1-fallback)도 별도 그룹으로 분리', () => {
    const rows = joinResults([pred(0.9, 1, '말1', null)], [result(1, 1, '말1')]);
    const byVersion = computeTiersByVersion(rows, 0.72, 0.62);
    expect(byVersion).toHaveLength(1);
    expect(byVersion[0]!.modelVersion).toBeNull();
  });
});
