import { describe, it, expect } from 'vitest';
import { precheckRmse, judgePrecheck, type PrecheckRow, type SliceStat } from './shapeStatePrecheck.js';

const base = { meet: 1, dist: 1200 };
const fillers = (): PrecheckRow[] =>
  Array.from({ length: 40 }, (_, i) => ({ ...base, date: 20230101 + i, rcNo: 1, hk: `f${i}`, state: '건조', g3f: 48, fin600: 38 }));
const hist = (hk: string, state: string, g3f: number, fin600: number): PrecheckRow[] =>
  [20230201, 20230202].map((date) => ({ ...base, date, rcNo: 1, hk, state, g3f, fin600 }));
const testRace = (state: string): PrecheckRow[] =>
  ['A', 'B'].map((hk) => ({ ...base, date: 20240110, rcNo: 1, hk, state, g3f: 48, fin600: 38 }));

describe('precheckRmse', () => {
  it('말 A는 불량에서만, B는 건조에서만 뛴 과거 — 실제 능력이 같으면 환산(ON)이 오차를 없앤다', () => {
    const rows = [
      ...fillers(),
      ...hist('A', '불량', 48 * (1 - 0.0215), 38 * (1 - 0.0178)),
      ...hist('B', '건조', 48, 38),
      ...testRace('건조'),
    ];
    const s = precheckRmse(rows, 20240101).get(2024)!;
    expect(s.races).toBe(1);
    expect(s.horses).toBe(2);
    expect(s.sseOffE).toBeGreaterThan(0.4);
    expect(s.sseOnE).toBeLessThan(1e-9);
    expect(s.sseOffL).toBeGreaterThan(0.1);
    expect(s.sseOnL).toBeLessThan(1e-9);
  });

  it('경주 내 예측 보유 말이 2두 미만이면 집계 제외', () => {
    const rows = [
      ...fillers(),
      ...hist('A', '불량', 47, 37.4),
      { ...base, date: 20240110, rcNo: 1, hk: 'A', state: '건조', g3f: 48, fin600: 38 },
      { ...base, date: 20240110, rcNo: 1, hk: 'NEW', state: '건조', g3f: 48, fin600: 38 },
    ];
    expect(precheckRmse(rows, 20240101).get(2024)).toBeUndefined();
  });

  it('par 버킷이 없으면(표본 < 30) 집계 제외', () => {
    const rows = [...hist('A', '불량', 47, 37.4), ...hist('B', '건조', 48, 38), ...testRace('건조')];
    expect(precheckRmse(rows, 20240101).size).toBe(0);
  });
});

describe('judgePrecheck', () => {
  const st = (offE: number, onE: number): SliceStat => ({ races: 10, horses: 50, sseOffE: offE, sseOnE: onE, sseOffL: 100, sseOnL: 100 });
  it('상대 1% 이상 감소 슬라이스가 2개 이상이면 통과', () => {
    const m = new Map([[2024, st(100, 95)], [2025, st(100, 96)], [2026, st(100, 100)]]);
    const j = judgePrecheck(m);
    expect(j.pass).toBe(true);
    expect(j.slices.filter((x) => x.ok)).toHaveLength(2);
  });
  it('1개뿐이면 미통과', () => {
    const m = new Map([[2024, st(100, 95)], [2025, st(100, 100)], [2026, st(100, 101)]]);
    expect(judgePrecheck(m).pass).toBe(false);
  });
  it('OFF 오차가 0이면 감소율 0으로 처리(0 나눗셈 없음)', () => {
    const j = judgePrecheck(new Map([[2024, st(0, 0)]]));
    expect(j.slices[0]!.relEarly).toBe(0);
    expect(Number.isFinite(j.slices[0]!.relLate)).toBe(true);
  });
});
