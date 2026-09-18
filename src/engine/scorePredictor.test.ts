import { describe, it, expect } from 'vitest';
import { attachCalibratedProbs, scoreRaceRows, LINEAR_MODEL_TYPES, type RaceInputRow } from './scorePredictor.js';
import type { CalibratedArtifact } from './eval/calibratedProbs.js';
import type { ActiveModelVersion } from './modelVersion.js';

function model(coefX: number): CalibratedArtifact {
  return { type: 'logistic', features: ['x'], means: [0], stds: [1], coef: { x: coefX }, intercept: 0 };
}

describe('attachCalibratedProbs', () => {
  it('calibration 없으면 p_win/p_top3 null', () => {
    const r = attachCalibratedProbs(model(1), [[0], [1]]);
    expect(r).toEqual([{ p_win: null, p_top3: null }, { p_win: null, p_top3: null }]);
  });

  it('calibration 있으면 (0,1) 범위 확률', () => {
    const base = model(1);
    const artifact: CalibratedArtifact = {
      ...base,
      calibration: {
        p1Model: model(2), platt1: { a: 1, b: 0 }, platt3: { a: 1, b: 0 },
        renormWin: false, fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
      },
    };
    const r = attachCalibratedProbs(artifact, [[0], [1], [2]]);
    expect(r).toHaveLength(3);
    for (const row of r) {
      expect(row.p_win!).toBeGreaterThan(0); expect(row.p_win!).toBeLessThan(1);
      expect(row.p_top3!).toBeGreaterThan(0); expect(row.p_top3!).toBeLessThan(1);
    }
  });
});

describe('scoreRaceRows', () => {
  // buildFeatures가 만드는 실제 피처명 중 하나를 쓰지 않아도 됨: 입력에 없는 피처는 raw=0으로 채점(패리티 규칙)
  const linear = (coef: number) => ({
    type: 'logistic' as const, features: ['f'], means: [0], stds: [1], coef: { f: coef }, intercept: 0.5,
  });
  const rows: RaceInputRow[] = [
    { hr_name: 'A', pthr_no: 1, ord: null, input: {} as never },
    { hr_name: 'B', pthr_no: 2, ord: 3, input: {} as never },
  ];

  it('선형 모델이면 intercept 기반 총점·순위·버전 도장을 만든다', () => {
    const v: ActiveModelVersion = { id: 42, label: 't', model_type: 'logistic', weights: {}, artifact: linear(1) };
    const out = scoreRaceRows(rows, v, 20260912, 1, 3);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ race_date: 20260912, meet: 1, rc_no: 3, hr_name: 'A', model_version: 42, actual_ord: null });
    expect(out[1]!.actual_ord).toBe(3);
    expect(new Set(out.map((r) => r.predicted_rank))).toEqual(new Set([1, 2]));
    expect(out[0]!.p_top3).toBeNull(); // calibration 없음
  });

  it('pl-top3도 선형 채점 경로를 탄다', () => {
    expect(LINEAR_MODEL_TYPES.has('pl-top3')).toBe(true);
    const v: ActiveModelVersion = { id: 9, label: 'p', model_type: 'pl-top3', weights: {}, artifact: { ...linear(1), intercept: 0 } };
    const out = scoreRaceRows(rows, v, 20260912, 1, 3);
    expect(out.every((r) => typeof r.total_score === 'number')).toBe(true);
  });
});
