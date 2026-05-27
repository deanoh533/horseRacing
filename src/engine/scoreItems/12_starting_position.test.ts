import { describe, it, expect } from 'vitest';
import { calculateStartingPositionScore } from './12_starting_position';

describe('⑫ 출발번호', () => {
  it('stOrd 0 또는 totalHorses 1 → 0.5 (중립)', () => {
    expect(calculateStartingPositionScore({ stOrd: 0, totalHorses: 10, rcDist: 1200 })).toBe(0.5);
    expect(calculateStartingPositionScore({ stOrd: 1, totalHorses: 1, rcDist: 1200 })).toBe(0.5);
  });

  it('단거리 1번 (안쪽) → 가장 높은 점수 (1.0)', () => {
    // relativePos = (10-1)/9 = 1.0, weight 1.0 → 0.5 + (1.0-0.5)*1.0 = 1.0
    expect(
      calculateStartingPositionScore({ stOrd: 1, totalHorses: 10, rcDist: 1200 })
    ).toBe(1.0);
  });

  it('단거리 10번 (바깥) → 가장 낮은 점수 (0)', () => {
    // relativePos = 0, weight 1.0 → 0.5 + (0-0.5)*1.0 = 0
    expect(
      calculateStartingPositionScore({ stOrd: 10, totalHorses: 10, rcDist: 1200 })
    ).toBe(0);
  });

  it('단거리 중간 (5번/10마) → 약 0.5', () => {
    // relativePos = 5/9 ≈ 0.556 → 0.5 + 0.056 = 0.556
    expect(
      calculateStartingPositionScore({ stOrd: 5, totalHorses: 10, rcDist: 1200 })
    ).toBeCloseTo(0.556, 2);
  });

  it('중거리(1500m) 1번 → 영향 50% → 0.75', () => {
    // relativePos 1.0, weight 0.5 → 0.5 + 0.5*0.5 = 0.75
    expect(
      calculateStartingPositionScore({ stOrd: 1, totalHorses: 10, rcDist: 1500 })
    ).toBe(0.75);
  });

  it('장거리(2000m) 1번 → 영향 20% → 0.6', () => {
    // relativePos 1.0, weight 0.2 → 0.5 + 0.5*0.2 = 0.6
    expect(
      calculateStartingPositionScore({ stOrd: 1, totalHorses: 10, rcDist: 2000 })
    ).toBe(0.6);
  });
});

describe('⑫ 출발번호 — 주행 성향 multiplier', () => {
  it('도주마(avg=0.1) + 안쪽 번호(1번) → base(1.0) × 1.5 → 클램프 1.0', () => {
    // baseScore = 1.0, ×1.5 = 1.5 → clamp → 1.0
    expect(
      calculateStartingPositionScore({
        stOrd: 1,
        totalHorses: 10,
        rcDist: 1200,
        avgPositionRatio: 0.1,
      })
    ).toBe(1.0);
  });

  it('도주마(avg=0.1) + 바깥 번호(10번) → base(0.0) × 1.5 → 클램프 0 이상', () => {
    // baseScore = 0.0, ×1.5 = 0.0 → 0
    const score = calculateStartingPositionScore({
      stOrd: 10,
      totalHorses: 10,
      rcDist: 1200,
      avgPositionRatio: 0.1,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBe(0);
  });

  it('추입마(avg=0.8) → base × 0.5', () => {
    // base for stOrd=1, 10마, 1200m = 1.0 → ×0.5 = 0.5
    expect(
      calculateStartingPositionScore({
        stOrd: 1,
        totalHorses: 10,
        rcDist: 1200,
        avgPositionRatio: 0.8,
      })
    ).toBe(0.5);
  });

  it('자유마(stddev=0.4) → multiplier 1.0 그대로', () => {
    // stddev ≥ 0.35 → 자유마, ×1.0
    // base for stOrd=1, 10마, 1200m = 1.0 → ×1.0 = 1.0
    expect(
      calculateStartingPositionScore({
        stOrd: 1,
        totalHorses: 10,
        rcDist: 1200,
        avgPositionRatio: 0.1, // 도주마 범위지만 stddev 우선
        stddevPositionRatio: 0.4,
      })
    ).toBe(1.0);
  });

  it('avgPositionRatio 없으면 × 1.0 그대로', () => {
    // 데이터 없음 → multiplier 1.0
    // base for stOrd=1, 10마, 1200m = 1.0
    expect(
      calculateStartingPositionScore({
        stOrd: 1,
        totalHorses: 10,
        rcDist: 1200,
        avgPositionRatio: null,
      })
    ).toBe(1.0);
  });
});
