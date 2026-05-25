import { describe, it, expect } from 'vitest';
import { calculateTrackAdaptationScore } from './07_track_adaptation';

describe('⑦ 주로 적응 (향상도)', () => {
  it('같은 주로 이력 0개 → 0.5', () => {
    expect(
      calculateTrackAdaptationScore({ overallOrds: [3, 4, 5], sameTrackOrds: [] })
    ).toBe(0.5);
  });

  it('전체 이력 < 3 → 0.5', () => {
    expect(
      calculateTrackAdaptationScore({ overallOrds: [1, 2], sameTrackOrds: [1] })
    ).toBe(0.5);
  });

  it('이 주로에서 평균 1위, 전체 평균 4위 (향상도 3) → 1.0 만점', () => {
    expect(
      calculateTrackAdaptationScore({
        overallOrds: [4, 4, 4],
        sameTrackOrds: [1, 1, 1],
      })
    ).toBe(1.0);
  });

  it('이 주로에서 평균 3위, 전체 4위 (향상도 1) → 0.75', () => {
    expect(
      calculateTrackAdaptationScore({
        overallOrds: [4, 4, 4],
        sameTrackOrds: [3, 3],
      })
    ).toBe(0.75);
  });

  it('같음 (향상도 0) → 0.5', () => {
    expect(
      calculateTrackAdaptationScore({
        overallOrds: [3, 3, 3],
        sameTrackOrds: [3, 3],
      })
    ).toBe(0.5);
  });

  it('이 주로에서 평소보다 0.5위 못함 → 0.25', () => {
    // overallAvg=2, sameTrackAvg=2.5 → improvement=-0.5 → -1.0 <= -0.5 < 0 → 0.25
    expect(
      calculateTrackAdaptationScore({
        overallOrds: [2, 2, 2],
        sameTrackOrds: [2, 3],
      })
    ).toBe(0.25);
  });

  it('이 주로에서 매우 약함 (향상도 -2) → 0.0', () => {
    expect(
      calculateTrackAdaptationScore({
        overallOrds: [1, 1, 1],
        sameTrackOrds: [5, 5],
      })
    ).toBe(0.0);
  });
});
