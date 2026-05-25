import { describe, it, expect } from 'vitest';
import { calculateLatePositionScore } from './05_late_position';

describe('⑤ 후반 구간 순위', () => {
  it('빈 입력 → 0.5 (중립)', () => {
    expect(calculateLatePositionScore({ positions: [] })).toBe(0.5);
  });

  it('1펄롱 1위 → 마지막 1위 (선두 유지) → 매우 높은 점수', () => {
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 1 }],
    });
    expect(score).toBeGreaterThan(0.8); // 100×0.8 + 30×0.2 = 86 → 0.86
  });

  it('5위 → 1위 (강한 추월) → 만점', () => {
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 5, finishOrd: 1 }],
    });
    // finishScore 100 × 0.8 + changeBonus 100 × 0.2 = 100 → 1.0
    expect(score).toBe(1.0);
  });

  it('1위 → 5위 (역추월/퇴보) → 낮은 점수', () => {
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 5 }],
    });
    // finishScore 20 × 0.8 + (-100) × 0.2 = 16 - 20 = clamp 0 → 실제는 0~?
    expect(score).toBeLessThan(0.3);
  });

  it('데이터 없음 (0,0) → 50 score → 0.5', () => {
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 0, finishOrd: 0 }],
    });
    expect(score).toBe(0.5);
  });

  it('가중 평균: 최근 경주 영향 가장 큼', () => {
    // 최근 1위 추월 (만점), 과거 5위 → 가중 평균은 최근 쪽으로 기울어야
    const recentGood = calculateLatePositionScore({
      positions: [
        { startOrd: 5, finishOrd: 1 },
        { startOrd: 1, finishOrd: 5 },
      ],
    });
    const recentBad = calculateLatePositionScore({
      positions: [
        { startOrd: 1, finishOrd: 5 },
        { startOrd: 5, finishOrd: 1 },
      ],
    });
    expect(recentGood).toBeGreaterThan(recentBad);
  });
});
