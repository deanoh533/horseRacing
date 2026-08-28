import { describe, it, expect } from 'vitest';
import { classifyRaceDate, type RaceDateCounts } from './syncHealth.js';

const c = (over: Partial<RaceDateCounts>): RaceDateCounts => ({
  raceDate: 20260815, entries: 100, ordFilled: 98,
  races: 10, racesWithResult: 10, stTimeFilled: 10, comboRows: 9000, ...over,
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

describe('classifyRaceDate — 부분 결과(경주 단위 대조)', () => {
  const TODAY = 20260828;

  // 실측 20260822·20260815: 19시 sync 시점에 서울 R9·R10이 아직 KRA에 없어
  // 10경주 중 8경주만 결과가 왔다. ordFilled > 0이라 기존 판정은 ✅ 정상이었다.
  it('일부 경주만 결과가 오면 gap (두수가 아니라 경주 수로 판정)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260822, entries: 97, ordFilled: 75, races: 10, racesWithResult: 8 }), TODAY
    )).toBe('gap');
  });

  it('제외마 때문에 두수만 모자란 날은 gap이 아니다 (경주는 전부 왔다)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260821, entries: 88, ordFilled: 87, races: 8, racesWithResult: 8 }), TODAY
    )).toBe('ok');
  });

  it('gap은 조합배당 누락(partial)보다 우선한다 — 재싱크가 둘 다 채운다', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260822, ordFilled: 75, races: 10, racesWithResult: 8, comboRows: 0 }), TODAY
    )).toBe('gap');
  });

  it('오늘/미래 경주는 일부만 왔어도 pending (진행 중인 게 정상)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260828, ordFilled: 40, races: 10, racesWithResult: 4 }), TODAY
    )).toBe('pending');
  });

  it('races가 0이면 경주 단위 대조를 하지 않는다 (0 < 0 비교로 오탐 금지)', () => {
    expect(classifyRaceDate(
      c({ raceDate: 20260821, ordFilled: 87, races: 0, racesWithResult: 0 }), TODAY
    )).toBe('ok');
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
