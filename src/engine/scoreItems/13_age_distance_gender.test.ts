import { describe, it, expect } from 'vitest';
import { calculateAgeDistanceGenderScore } from './13_age_distance_gender';

describe('⑬ 나이 × 거리 × 성별 (임시 매트릭스)', () => {
  it('3세 단거리(1200) → 1.0 (절정)', () => {
    expect(
      calculateAgeDistanceGenderScore({ age: 3, sex: '수', rcDist: 1200 })
    ).toBe(1.0);
  });

  it('3세 장거리(2000) → 0.0', () => {
    expect(
      calculateAgeDistanceGenderScore({ age: 3, sex: '수', rcDist: 2000 })
    ).toBe(0);
  });

  it('6세 장거리 → 1.0', () => {
    expect(
      calculateAgeDistanceGenderScore({ age: 6, sex: '수', rcDist: 2000 })
    ).toBe(1.0);
  });

  it('5세 중거리(1600) → 0.9', () => {
    expect(
      calculateAgeDistanceGenderScore({ age: 5, sex: '수', rcDist: 1600 })
    ).toBe(0.9);
  });

  it('7세+ 는 6세와 동일', () => {
    const s6 = calculateAgeDistanceGenderScore({ age: 6, sex: '수', rcDist: 1800 });
    const s9 = calculateAgeDistanceGenderScore({ age: 9, sex: '수', rcDist: 1800 });
    expect(s9).toBe(s6);
  });

  it('암말 단거리 보너스 +10%', () => {
    // base 1.0 (3세 단거리) × 1.1 = 1.1 → clamp 1.0
    expect(
      calculateAgeDistanceGenderScore({ age: 3, sex: '암', rcDist: 1200 })
    ).toBe(1.0);
    // base 0.9 (4세 단거리) × 1.1 = 0.99
    expect(
      calculateAgeDistanceGenderScore({ age: 4, sex: '암', rcDist: 1200 })
    ).toBeCloseTo(0.99, 2);
  });

  it('암말 장거리 페널티 -10%', () => {
    // base 0.4 (4세 장거리) × 0.9 = 0.36
    expect(
      calculateAgeDistanceGenderScore({ age: 4, sex: '암', rcDist: 2000 })
    ).toBeCloseTo(0.36, 2);
  });
});
