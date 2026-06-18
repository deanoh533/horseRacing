import { describe, it, expect } from 'vitest';
import { attachCalibratedProbs } from './scorePredictor.js';
import type { CalibratedArtifact } from './eval/calibratedProbs.js';

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
    for (const row of r) {
      expect(row.p_win!).toBeGreaterThan(0); expect(row.p_win!).toBeLessThan(1);
      expect(row.p_top3!).toBeGreaterThan(0); expect(row.p_top3!).toBeLessThan(1);
    }
  });
});
