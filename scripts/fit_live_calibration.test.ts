import { describe, it, expect } from 'vitest';
import { buildCalibration, type MatrixRow } from './fit_live_calibration.js';
import type { LogisticModel } from '../src/engine/models/logistic.js';
import { calibratedRaceProbs } from '../src/engine/eval/calibratedProbs.js';

// 합성: 피처 x가 클수록 1착·3착 확률↑. 5경주 × 4마리.
function synth(): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (let r = 0; r < 5; r++) {
    for (let h = 0; h < 4; h++) {
      const x = h; // 0..3
      rows.push({
        race_date: 20240100 + r, meet: 1, rc_no: 1,
        ord: 4 - h,                       // x 큰 말이 1착(ord 1)
        top3: (4 - h) <= 3 ? 1 : 0,
        features: [{ name: 'x', value: x }],
      });
    }
  }
  return rows;
}

describe('buildCalibration', () => {
  const base: LogisticModel = {
    type: 'logistic', features: ['x'], means: [1.5], stds: [1.1],
    coef: { x: 1.0 }, intercept: 0,
  };

  it('calibration 구조 생성 + 계수 유한', () => {
    const cal = buildCalibration(base, synth(), { renormWin: false, baseModelId: 6 });
    expect(cal.p1Model.features).toEqual(['x']);
    expect(Number.isFinite(cal.platt1.a)).toBe(true);
    expect(Number.isFinite(cal.platt1.b)).toBe(true);
    expect(Number.isFinite(cal.platt3.a)).toBe(true);
    expect(cal.fitMeta.rows).toBe(20);
    expect(cal.fitMeta.baseModelId).toBe(6);
    expect(cal.renormWin).toBe(false);
  });

  it('생성된 calibration으로 보정 확률이 (0,1)', () => {
    const cal = buildCalibration(base, synth(), { renormWin: true, baseModelId: 6 });
    const artifact = { ...base, calibration: cal };
    const { pWin, pTop3 } = calibratedRaceProbs(artifact, [[0], [1], [2], [3]]);
    for (const v of [...pWin, ...pTop3]) {
      expect(v!).toBeGreaterThan(0); expect(v!).toBeLessThan(1);
    }
    expect(pWin.reduce((s: number, v) => s + v!, 0)).toBeCloseTo(1, 6); // renorm
  });
});
