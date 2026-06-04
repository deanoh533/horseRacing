import { describe, it, expect } from 'vitest';
import { fitGBDT, predictGBDT } from './gbdt.js';

function sigmoid(z: number) { return 1 / (1 + Math.exp(-z)); }

describe('fitGBDT', () => {
  it('XOR 비선형 패턴(로지스틱 불가)을 잡는다', () => {
    const X: number[][] = []; const y: number[] = [];
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < 3000; i++) {
      const x1 = rnd() * 2 - 1, x2 = rnd() * 2 - 1;
      X.push([x1, x2]);
      y.push((x1 > 0) !== (x2 > 0) ? 1 : 0);
    }
    const model = fitGBDT(X, y, ['x1', 'x2'], { rounds: 60, maxDepth: 3, lr: 0.3, lambda: 1, minChild: 20, bins: 32 });
    expect(sigmoid(predictGBDT(model, [0.5, 0.5]))).toBeLessThan(0.4);
    expect(sigmoid(predictGBDT(model, [0.5, -0.5]))).toBeGreaterThan(0.6);
    expect(sigmoid(predictGBDT(model, [-0.5, 0.5]))).toBeGreaterThan(0.6);
    expect(sigmoid(predictGBDT(model, [-0.5, -0.5]))).toBeLessThan(0.4);
  });

  it('상수 라벨이면 base만으로 안정 (NaN 없음)', () => {
    const X = [[0], [1], [2], [3]]; const y = [1, 1, 1, 1];
    const m = fitGBDT(X, y, ['a'], { rounds: 10, maxDepth: 2, lr: 0.3, lambda: 1, minChild: 1, bins: 8 });
    const p = sigmoid(predictGBDT(m, [1.5]));
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(0.9);
  });
});
