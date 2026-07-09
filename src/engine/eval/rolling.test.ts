import { describe, it, expect } from 'vitest';
import { quarterKey, splitByQuarter, rollingBlocks, parseYearQuarter, quarterEnd } from './rolling.js';
import type { RaceRecord } from './types.js';

const race = (raceDate: number): RaceRecord => ({
  raceDate, meet: 1, rcNo: 1,
  horses: [
    { hrName: 'a', pthrNo: 1, ord: 1, winOdds: 2, rawScores: {}, features: [] },
    { hrName: 'b', pthrNo: 2, ord: 2, winOdds: 3, rawScores: {}, features: [] },
    { hrName: 'c', pthrNo: 3, ord: 3, winOdds: 5, rawScores: {}, features: [] },
  ],
});

describe('quarterKey', () => {
  it('YYYYMMDD → YYYY-Qn', () => {
    expect(quarterKey(20250105)).toBe('2025-Q1');
    expect(quarterKey(20250715)).toBe('2025-Q3');
    expect(quarterKey(20251231)).toBe('2025-Q4');
  });
});

describe('parseYearQuarter', () => {
  it('YYYYQn 문자열을 파싱한다', () => {
    expect(parseYearQuarter('2024Q3')).toEqual({ year: 2024, q: 3 });
    expect(parseYearQuarter('2025Q1')).toEqual({ year: 2025, q: 1 });
  });

  it('형식·범위가 틀리면 명확한 에러를 던진다', () => {
    expect(() => parseYearQuarter('2024Q5')).toThrow(/YYYYQn/);
    expect(() => parseYearQuarter('2024-Q3')).toThrow(/YYYYQn/);
    expect(() => parseYearQuarter('24Q3')).toThrow(/YYYYQn/);
    expect(() => parseYearQuarter('')).toThrow(/YYYYQn/);
  });
});

describe('quarterEnd', () => {
  it('분기 마지막 날 YYYYMMDD (포함 경계)', () => {
    expect(quarterEnd(2024, 1)).toBe(20240331);
    expect(quarterEnd(2024, 2)).toBe(20240630);
    expect(quarterEnd(2024, 3)).toBe(20240930);
    expect(quarterEnd(2025, 4)).toBe(20251231);
  });
});

describe('splitByQuarter', () => {
  it('분기 키로 경주를 그룹화한다', () => {
    const races = [race(20250105), race(20250210), race(20250705)];
    const m = splitByQuarter(races);
    expect(m.get('2025-Q1')?.length).toBe(2);
    expect(m.get('2025-Q3')?.length).toBe(1);
  });
});

describe('rollingBlocks', () => {
  it('각 테스트 분기의 train은 그 분기 시작 이전만 (누수 없음)', () => {
    const races = [race(20240601), race(20250105), race(20250705)];
    const blocks = rollingBlocks(races, { year: 2025, q: 1 });
    const q1 = blocks.find((b) => b.key === '2025-Q1')!;
    expect(q1.train.every((r) => r.raceDate < 20250101)).toBe(true);
    expect(q1.test.every((r) => quarterKey(r.raceDate) === '2025-Q1')).toBe(true);
    const q3 = blocks.find((b) => b.key === '2025-Q3')!;
    expect(q3.train.some((r) => r.raceDate === 20250105)).toBe(true);
    expect(q3.train.every((r) => r.raceDate < 20250701)).toBe(true);
  });

  it('첫 테스트 분기 이전(부트스트랩) 분기는 test 블록으로 안 만든다', () => {
    const races = [race(20240601), race(20250105)];
    const blocks = rollingBlocks(races, { year: 2025, q: 1 });
    expect(blocks.find((b) => b.key === '2024-Q2')).toBeUndefined();
  });
});
