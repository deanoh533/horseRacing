import { describe, it, expect } from 'vitest';
import { fitLogistic, predictLogit } from './logistic.js';

describe('fitLogistic', () => {
  it('알려진 선형 분리 데이터의 계수 부호·확률을 회복한다', () => {
    const X: number[][] = [];
    const y: number[] = [];
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 2000; i++) {
      const x1 = rnd() * 4 - 2, x2 = rnd() * 4 - 2;
      X.push([x1, x2]);
      y.push(2 * x1 - 1 * x2 + (rnd() - 0.5) * 0.5 > 0 ? 1 : 0);
    }
    const model = fitLogistic(X, y, ['x1', 'x2'], { l2: 0.01, iters: 500, lr: 0.1 });
    expect(model.coef['x1']).toBeGreaterThan(0);
    expect(model.coef['x2']).toBeLessThan(0);
    expect(Math.abs(model.coef['x1'])).toBeGreaterThan(Math.abs(model.coef['x2']));
    const p = 1 / (1 + Math.exp(-predictLogit(model, [2, -2])));
    expect(p).toBeGreaterThan(0.9);
  });
});
