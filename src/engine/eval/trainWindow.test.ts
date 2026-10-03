import { describe, it, expect } from 'vitest';
import { windowTrain, windowCovered } from './trainWindow.js';
import type { RaceRecord } from './types.js';

const r = (raceDate: number): RaceRecord => ({ raceDate, meet: 1, rcNo: 1, horses: [] });
const races = [r(20220615), r(20230101), r(20240315), r(20241231), r(20250101)];

describe('windowTrain', () => {
  it('시험 분기 시작 직전 N년만 (시작일 미포함)', () => {
    expect(windowTrain(races, 20250101, 1).map((x) => x.raceDate)).toEqual([20240315, 20241231]);
    expect(windowTrain(races, 20250101, 2).map((x) => x.raceDate)).toEqual([20230101, 20240315, 20241231]);
  });
  it('분기 중간 시작일(0401)도 N년 전 같은 날짜부터', () => {
    expect(windowTrain(races, 20240401, 2).map((x) => x.raceDate)).toEqual([20220615, 20230101, 20240315]);
  });
});

describe('windowCovered', () => {
  it('수집 시작일이 창 시작일 이하일 때만 창이 온전하다', () => {
    expect(windowCovered(20210101, 20250101, 4)).toBe(true);
    expect(windowCovered(20210102, 20250101, 4)).toBe(false);
  });
});
