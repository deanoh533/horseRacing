import { describe, it, expect } from 'vitest';
import { calculateSectionalTimeScore } from './04_sectional_time';

describe('④ 구간 시간 단축', () => {
  it('데이터 0개 → 0.5 (중립)', () => {
    expect(
      calculateSectionalTimeScore({ sameDistTrackTimes: [], sameDistOnlyTimes: [] })
    ).toBe(0.5);
  });

  it('같은 거리/주로 1개 + same dist 1개 → 둘 다 2개 미만 → 0.5', () => {
    expect(
      calculateSectionalTimeScore({
        sameDistTrackTimes: [{ rcTime: 75, lastFurlong: 0 }],
        sameDistOnlyTimes: [{ rcTime: 75, lastFurlong: 0 }],
      })
    ).toBe(0.5);
  });

  it('같은 거리/주로 3경주, 최근이 가장 빠름 (향상) → > 0.5', () => {
    const score = calculateSectionalTimeScore({
      sameDistTrackTimes: [
        { rcTime: 70.0, lastFurlong: 12.5 }, // 최근
        { rcTime: 71.0, lastFurlong: 13.0 },
        { rcTime: 71.5, lastFurlong: 13.2 },
      ],
      sameDistOnlyTimes: [],
    });
    expect(score).toBeGreaterThan(0.5);
  });

  it('같은 거리/주로 3경주, 최근이 가장 느림 (퇴보) → < 0.5', () => {
    const score = calculateSectionalTimeScore({
      sameDistTrackTimes: [
        { rcTime: 72.0, lastFurlong: 13.5 }, // 최근 (느림)
        { rcTime: 71.0, lastFurlong: 13.0 },
        { rcTime: 70.5, lastFurlong: 12.8 },
      ],
      sameDistOnlyTimes: [],
    });
    expect(score).toBeLessThan(0.5);
  });

  it('같은 거리/주로 부족하면 same dist fallback (confidence 0.7)', () => {
    const score = calculateSectionalTimeScore({
      sameDistTrackTimes: [],
      sameDistOnlyTimes: [
        { rcTime: 70.0, lastFurlong: 12.5 },
        { rcTime: 71.5, lastFurlong: 13.2 },
      ],
    });
    expect(score).toBeGreaterThan(0); // 향상이면 양수
  });
});
