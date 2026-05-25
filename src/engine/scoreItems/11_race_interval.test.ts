import { describe, it, expect } from 'vitest';
import { calculateRaceIntervalScore } from './11_race_interval';

describe('⑪ 경주 간격', () => {
  it('null (데뷔전) → 0', () => {
    expect(calculateRaceIntervalScore({ intervalDays: null })).toBe(0);
  });

  it('14일 미만 (피로 누적) → 0', () => {
    expect(calculateRaceIntervalScore({ intervalDays: 7 })).toBe(0);
    expect(calculateRaceIntervalScore({ intervalDays: 13 })).toBe(0);
  });

  it('14~27일 (약간 짧음) → 0.25', () => {
    expect(calculateRaceIntervalScore({ intervalDays: 20 })).toBe(0.25);
    expect(calculateRaceIntervalScore({ intervalDays: 27 })).toBe(0.25);
  });

  it('28~35일 (최적) → 1.0 만점', () => {
    expect(calculateRaceIntervalScore({ intervalDays: 28 })).toBe(1.0);
    expect(calculateRaceIntervalScore({ intervalDays: 30 })).toBe(1.0);
    expect(calculateRaceIntervalScore({ intervalDays: 35 })).toBe(1.0);
  });

  it('36~60일 (약간 김) → 0.5', () => {
    expect(calculateRaceIntervalScore({ intervalDays: 40 })).toBe(0.5);
    expect(calculateRaceIntervalScore({ intervalDays: 60 })).toBe(0.5);
  });

  it('61~90일 (김) → 0.25', () => {
    expect(calculateRaceIntervalScore({ intervalDays: 70 })).toBe(0.25);
    expect(calculateRaceIntervalScore({ intervalDays: 90 })).toBe(0.25);
  });

  it('90일 초과 (감각 저하) → 0', () => {
    expect(calculateRaceIntervalScore({ intervalDays: 100 })).toBe(0);
    expect(calculateRaceIntervalScore({ intervalDays: 365 })).toBe(0);
  });
});
