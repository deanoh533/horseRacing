import { describe, it, expect } from 'vitest';
import { calculateTrainerRecentScore } from './10b_trainer_recent';

describe('⑩b 조교사 최근 3개월형', () => {
  it('데이터 없음 → 0.5 중립', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [] })).toBe(0.5);
  });

  it('4전 전원 1~2위 → 1.0', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [1, 2, 1, 2] })).toBe(1.0);
  });

  it('4전 전원 3위+ → 0.0', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [3, 4, 5, 6] })).toBe(0.0);
  });

  it('5전 2회 복승(1~2위) → 0.4', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [1, 2, 3, 4, 5] })).toBe(0.4);
  });

  it('3전 1회 1위, 1회 2위 → 0.667', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [1, 2, 4] })).toBeCloseTo(0.667, 2);
  });
});
