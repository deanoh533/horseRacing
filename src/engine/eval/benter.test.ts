import { describe, it, expect } from 'vitest';
import { softmax, marketProbsFromOdds } from './benter.js';

describe('softmax', () => {
  it('합=1, 큰 점수에 큰 확률', () => {
    const p = softmax([0, 1, 2]);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(p[2]).toBeGreaterThan(p[1]!);
    expect(p[1]).toBeGreaterThan(p[0]!);
  });
  it('큰 값 오버플로 방어(max 빼기)', () => {
    const p = softmax([1000, 1001]);
    expect(Number.isFinite(p[0]!)).toBe(true);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });
});

describe('marketProbsFromOdds', () => {
  it('역수 정규화 — 합=1, 낮은 배당이 높은 확률', () => {
    const p = marketProbsFromOdds([2, 4, 8]);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(p[0]).toBeCloseTo(0.5714, 3);
    expect(p[0]).toBeGreaterThan(p[1]!);
  });
});
