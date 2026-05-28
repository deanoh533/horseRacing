import { describe, it, expect } from 'vitest';
import { calculateJockeyRecentScore } from './09b_jockey_recent';

describe('⑨b 기수 최근 3개월형', () => {
  it('데이터 없음 → 0.5 중립', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [] })).toBe(0.5);
  });

  it('3전 전승 → 1.0', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [1, 1, 1] })).toBe(1.0);
  });

  it('3전 전패 → 0.0', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [5, 4, 3] })).toBe(0.0);
  });

  it('5전 2승 → 0.4', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [1, 1, 2, 3, 4] })).toBe(0.4);
  });

  it('1전 1승 → 1.0', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [1] })).toBe(1.0);
  });
});
