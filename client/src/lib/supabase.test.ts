import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTodayRaceDate } from './supabase';

describe('getTodayRaceDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('오늘 날짜를 YYYYMMDD 숫자로 반환한다', () => {
    vi.setSystemTime(new Date(2026, 6, 11)); // 2026-07-11 (월은 0-indexed)
    expect(getTodayRaceDate()).toBe(20260711);
  });

  it('월/일이 한 자리인 경우 0으로 패딩한다', () => {
    vi.setSystemTime(new Date(2026, 0, 5)); // 2026-01-05
    expect(getTodayRaceDate()).toBe(20260105);
  });

  it('연말 날짜도 올바르게 반환한다', () => {
    vi.setSystemTime(new Date(2026, 11, 31)); // 2026-12-31
    expect(getTodayRaceDate()).toBe(20261231);
  });
});
