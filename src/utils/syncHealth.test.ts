import { describe, it, expect } from 'vitest';
import { classifyRaceDate, type RaceDateCounts } from './syncHealth.js';

const c = (over: Partial<RaceDateCounts>): RaceDateCounts => ({
  raceDate: 20260815, entries: 100, ordFilled: 98,
  races: 10, stTimeFilled: 10, comboRows: 9000, ...over,
});

describe('classifyRaceDate', () => {
  const TODAY = 20260823;

  it('결과·조합배당 다 있으면 ok', () => {
    expect(classifyRaceDate(c({}), TODAY)).toBe('ok');
  });

  it('오늘/미래 경주는 결과가 없어도 pending (구멍 아님)', () => {
    expect(classifyRaceDate(c({ raceDate: 20260823, ordFilled: 0, comboRows: 0 }), TODAY)).toBe('pending');
    expect(classifyRaceDate(c({ raceDate: 20260828, ordFilled: 0, comboRows: 0 }), TODAY)).toBe('pending');
  });

  it('지난 경주인데 결과가 0건이면 hole', () => {
    expect(classifyRaceDate(c({ raceDate: 20260821, ordFilled: 0, comboRows: 0 }), TODAY)).toBe('hole');
  });

  it('결과는 왔는데 조합배당만 비면 partial (조합 수집은 실패 격리됨)', () => {
    expect(classifyRaceDate(c({ raceDate: 20260821, ordFilled: 87, comboRows: 0 }), TODAY)).toBe('partial');
  });

  it('출전마가 아예 없으면 판정 불가 → hole로 보고 (휴장일은 애초에 행이 없어 목록에 안 뜸)', () => {
    expect(classifyRaceDate(c({ raceDate: 20260821, entries: 0, ordFilled: 0 }), TODAY)).toBe('hole');
  });
});

describe('classifyRaceDate — 조합배당 도입 이전 오탐 방지', () => {
  const TODAY = 20260823;

  it('조합배당 수집 도입(2026-07-29) 이전 경주는 조합배당 0이어도 ok', () => {
    expect(classifyRaceDate(c({ raceDate: 20260718, ordFilled: 106, comboRows: 0 }), TODAY)).toBe('ok');
  });

  it('도입 당일부터는 조합배당 0이면 partial', () => {
    expect(classifyRaceDate(c({ raceDate: 20260729, ordFilled: 100, comboRows: 0 }), TODAY)).toBe('partial');
  });
});
