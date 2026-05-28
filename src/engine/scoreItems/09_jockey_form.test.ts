import { describe, it, expect } from 'vitest';
import { calculateJockeyFormScore } from './09_jockey_form';

describe('⑨ 기수 통산 성적', () => {
  it('데이터 없음 (신인 등) → 0.5 중립', () => {
    expect(calculateJockeyFormScore({ careerWinRate: null, careerQuRate: null })).toBe(0.5);
  });

  it('qu_rate 40%, win_rate 15% → 0.43', () => {
    expect(calculateJockeyFormScore({ careerWinRate: 15, careerQuRate: 40 })).toBeCloseTo(0.43, 2);
  });

  it('qu_rate 90%, win_rate 50% → clamp 1.0', () => {
    expect(calculateJockeyFormScore({ careerWinRate: 50, careerQuRate: 90 })).toBe(1.0);
  });

  it('qu_rate 20%, win_rate null → 0.20', () => {
    expect(calculateJockeyFormScore({ careerWinRate: null, careerQuRate: 20 })).toBeCloseTo(0.20, 5);
  });

  it('qu_rate 20%, win_rate 10% → 0.20 + 0.02 = 0.22', () => {
    expect(calculateJockeyFormScore({ careerWinRate: 10, careerQuRate: 20 })).toBeCloseTo(0.22, 5);
  });

  it('통산 성적 높은 기수 > 낮은 기수', () => {
    const elite = calculateJockeyFormScore({ careerWinRate: 18, careerQuRate: 38 });
    const average = calculateJockeyFormScore({ careerWinRate: 8, careerQuRate: 15 });
    expect(elite).toBeGreaterThan(average);
  });
});
