import { describe, it, expect } from 'vitest';
import { calibratedRaceProbs, type Calibration } from './calibratedProbs.js';
import type { LogisticModel } from '../models/logistic.js';

// 피처 1개("x")짜리 최소 모델. means=0, stds=1 → predictLogit = intercept + coef*x.
function model(coefX: number, intercept = 0): LogisticModel {
  return { type: 'logistic', features: ['x'], means: [0], stds: [1], coef: { x: coefX }, intercept };
}

describe('calibratedRaceProbs', () => {
  it('calibration 없으면 모든 확률 null', () => {
    const base = model(1);
    const { pWin, pTop3 } = calibratedRaceProbs(base, [[0], [1], [2]]);
    expect(pWin).toEqual([null, null, null]);
    expect(pTop3).toEqual([null, null, null]);
  });

  it('p_top3 = applyPlatt(platt3, sigmoid(base logit)), 정규화 안 함', () => {
    const base = model(1, 0); // logit = x
    const cal: Calibration = {
      p1Model: model(1, 0),
      platt1: { a: 1, b: 0 },
      platt3: { a: 1, b: 0 }, // 항등 Platt → p_top3 = sigmoid(x)
      renormWin: false,
      fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    const { pTop3 } = calibratedRaceProbs(artifact, [[0], [2]]);
    expect(pTop3[0]).toBeCloseTo(0.5, 6);          // sigmoid(0)
    expect(pTop3[1]).toBeCloseTo(1 / (1 + Math.exp(-2)), 6);
  });

  it('p_win = 항등 Platt면 대칭 입력에 대칭 출력 (renormWin=false)', () => {
    const base = model(1, 0);
    const cal: Calibration = {
      p1Model: model(1, 0), platt1: { a: 1, b: 0 }, platt3: { a: 1, b: 0 },
      renormWin: false,
      fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    const { pWin } = calibratedRaceProbs(artifact, [[0], [0]]); // 동일 → 정규화 0.5/0.5
    expect(pWin[0]).toBeCloseTo(pWin[1]!, 9);       // 대칭
    expect(pWin[0]!).toBeGreaterThan(0);
    expect(pWin[0]!).toBeLessThan(1);
  });

  it('renormWin=true면 p_win 합≈1', () => {
    const base = model(1, 0);
    const cal: Calibration = {
      p1Model: model(2, 0), platt1: { a: 1.3, b: -0.2 }, platt3: { a: 1, b: 0 },
      renormWin: true,
      fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    const { pWin } = calibratedRaceProbs(artifact, [[0], [1], [2]]);
    const sum = pWin.reduce((s: number, v) => s + (v ?? 0), 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('1마리·빈 경주 방어', () => {
    const base = model(1, 0);
    const cal: Calibration = {
      p1Model: model(1, 0), platt1: { a: 1, b: 0 }, platt3: { a: 1, b: 0 },
      renormWin: true, fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    expect(calibratedRaceProbs(artifact, []).pWin).toEqual([]);
    const one = calibratedRaceProbs(artifact, [[1]]);
    expect(one.pWin[0]).toBeCloseTo(1, 6); // renorm 1마리 → 1
  });
});
