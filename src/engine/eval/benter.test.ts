import { describe, it, expect } from 'vitest';
import { softmax, marketProbsFromOdds, fitBenter, combinedProbs, winNLL, pickStats } from './benter.js';
import type { BenterRace } from './benter.js';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeRand(n: number, rng: () => number): number[] {
  const v = Array.from({ length: n }, () => rng() + 0.05);
  const s = v.reduce((a, b) => a + b, 0);
  return v.map((x) => x / s);
}

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

describe('combinedProbs', () => {
  it('b=0,a=1이면 시장확률과 동일(이미 정규화)', () => {
    const mkt = [0.5, 0.3, 0.2];
    const mod = [0.1, 0.6, 0.3];
    const c = combinedProbs(1, 0, mkt, mod);
    expect(c[0]).toBeCloseTo(0.5, 6);
    expect(c[1]).toBeCloseTo(0.3, 6);
    expect(c.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });
});

describe('fitBenter', () => {
  it('알려진 (a*,b*)에서 생성한 데이터를 근사 회수', () => {
    const rng = mulberry32(42);
    const A = 1.0, B = 0.8;
    const races: BenterRace[] = [];
    for (let r = 0; r < 4000; r++) {
      const n = 8;
      const mkt = normalizeRand(n, rng);
      const mod = normalizeRand(n, rng);
      const probs = combinedProbs(A, B, mkt, mod);
      const u = rng();
      let acc = 0, winnerIdx = n - 1;
      for (let k = 0; k < n; k++) { acc += probs[k]!; if (u <= acc) { winnerIdx = k; break; } }
      const ords = Array.from({ length: n }, (_, k) => (k === winnerIdx ? 1 : 2));
      races.push({ marketProb: mkt, modelProb: mod, ords, winnerIdx });
    }
    const { a, b } = fitBenter(races, { iters: 3000, lr: 0.5 });
    expect(a).toBeCloseTo(A, 0);
    expect(b).toBeCloseTo(B, 0);
    expect(b).toBeGreaterThan(0.3);
  });
});

describe('winNLL', () => {
  it('우승마 확률이 높을수록 NLL 낮음', () => {
    const good: BenterRace[] = [{ marketProb: [0.8, 0.2], modelProb: [0.8, 0.2], ords: [1, 2], winnerIdx: 0 }];
    const bad: BenterRace[] = [{ marketProb: [0.2, 0.8], modelProb: [0.2, 0.8], ords: [1, 2], winnerIdx: 0 }];
    const sel = (r: BenterRace) => r.marketProb;
    expect(winNLL(good, sel)).toBeLessThan(winNLL(bad, sel));
    expect(winNLL(good, sel)).toBeCloseTo(-Math.log(0.8), 6);
  });
});

describe('pickStats', () => {
  it('argmax 픽의 단승·연승 집계', () => {
    const races: BenterRace[] = [
      { marketProb: [0.6, 0.4], modelProb: [0.6, 0.4], ords: [1, 2], winnerIdx: 0 },
      { marketProb: [0.7, 0.3], modelProb: [0.7, 0.3], ords: [4, 1], winnerIdx: 1 },
    ];
    const s = pickStats(races, (r) => r.marketProb);
    expect(s.n).toBe(2);
    expect(s.win).toBe(1);
    expect(s.show).toBe(1);
  });
});
