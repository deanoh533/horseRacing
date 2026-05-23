import { describe, it, expect } from 'vitest';
import { calculateRecentFormScore } from './03_recent_form';

describe('③ 착순 추세', () => {
  it('데이터 없음 → 0.5 중립', () => {
    expect(calculateRecentFormScore({ ord5: [] })).toBe(0.5);
  });

  it('1-1-1-1-1 (모두 1등) → 1.0 만점', () => {
    expect(calculateRecentFormScore({ ord5: [1, 1, 1, 1, 1] })).toBe(1.0);
  });

  it('7-7-7-7-7 (모두 7등) → 매우 낮음 (안정성 보너스만)', () => {
    const score = calculateRecentFormScore({ ord5: [7, 7, 7, 7, 7] });
    expect(score).toBeLessThan(0.1);
    expect(score).toBeGreaterThan(0);
  });

  it('사용자 의도: 점진 향상 5-4-3-2-1 > 안정 3-3-3-3-3', () => {
    const improving = calculateRecentFormScore({ ord5: [5, 4, 3, 2, 1] });
    const stable = calculateRecentFormScore({ ord5: [3, 3, 3, 3, 3] });
    expect(improving).toBeGreaterThan(stable);
  });

  it('사용자 의도: 모두 1등(1-1-1-1-1) > 점진 향상 3-3-2-2-1', () => {
    const allFirst = calculateRecentFormScore({ ord5: [1, 1, 1, 1, 1] });
    const gradual = calculateRecentFormScore({ ord5: [3, 3, 2, 2, 1] });
    expect(allFirst).toBeGreaterThan(gradual);
  });

  it('점진 하락 1-2-3-4-5 → 낮은 점수 (기세 -5)', () => {
    const declining = calculateRecentFormScore({ ord5: [1, 2, 3, 4, 5] });
    const improving = calculateRecentFormScore({ ord5: [5, 4, 3, 2, 1] });
    expect(declining).toBeLessThan(improving);
  });

  it('5경주 미만도 처리됨 (3경주만)', () => {
    const score = calculateRecentFormScore({ ord5: [1, 2, 1] });
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1.0);
  });
});
