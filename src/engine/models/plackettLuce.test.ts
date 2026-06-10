import { describe, it, expect } from 'vitest';
import { fitPL, predictPL, type PLRace } from './plackettLuce.js';

/** 시드 난수 (logistic.test.ts와 동일 패턴) */
function makeRng(seed: number) {
  return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
}

/** 효용 u = 2*x1 - 1*x2 + 잡음 으로 경주별 착순(ord) 생성. 효용 큰 말 = ord 1. */
function makeRaces(nRaces: number, horsesPerRace: number, seed = 42): PLRace[] {
  const rnd = makeRng(seed);
  const races: PLRace[] = [];
  for (let r = 0; r < nRaces; r++) {
    const horses = [];
    for (let h = 0; h < horsesPerRace; h++) {
      const x1 = rnd() * 4 - 2, x2 = rnd() * 4 - 2;
      const u = 2 * x1 - 1 * x2 + (rnd() - 0.5) * 0.5;
      horses.push({ x: [x1, x2], u });
    }
    // 효용 내림차순 정렬 → ord = 1..K
    horses.sort((a, b) => b.u - a.u);
    races.push({ horses: horses.map((h, i) => ({ x: h.x, ord: i + 1 })) });
  }
  return races;
}

describe('fitPL', () => {
  it('합성 순위 데이터의 계수 부호·크기순서를 회복한다', () => {
    const races = makeRaces(400, 8);
    const model = fitPL(races, ['x1', 'x2'], { l2: 0.02, iters: 800, lr: 0.2 });
    expect(model.coef['x1']).toBeGreaterThan(0);
    expect(model.coef['x2']).toBeLessThan(0);
    expect(Math.abs(model.coef['x1']!)).toBeGreaterThan(Math.abs(model.coef['x2']!));
  });

  it('predictPL 점수는 효용이 높은 말에 더 높다 (랭킹 방향)', () => {
    const races = makeRaces(400, 8);
    const model = fitPL(races, ['x1', 'x2'], { l2: 0.02, iters: 800, lr: 0.2 });
    const good = predictPL(model, [2, -2]); // 높은 효용
    const bad = predictPL(model, [-2, 2]);  // 낮은 효용
    expect(good).toBeGreaterThan(bad);
  });

  it('PL은 위치 불변 — intercept는 0 (경주 내 상수항은 우도에서 상쇄)', () => {
    const races = makeRaces(200, 6);
    const model = fitPL(races, ['x1', 'x2'], { l2: 0.02, iters: 400, lr: 0.2 });
    expect(model.intercept).toBe(0);
    expect(model.type).toBe('plackett-luce');
  });
});
