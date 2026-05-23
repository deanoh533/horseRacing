import { describe, it, expect } from 'vitest';
import { calculateRatingScore } from './01_rating';

describe('① 레이팅', () => {
  it('rating 0 (6등급 미부여) → 0점', () => {
    expect(calculateRatingScore({ rating: 0 })).toBe(0);
  });

  it('rating 140 → 1.0 만점', () => {
    expect(calculateRatingScore({ rating: 140 })).toBe(1.0);
  });

  it('rating 70 → 0.5', () => {
    expect(calculateRatingScore({ rating: 70 })).toBe(0.5);
  });

  it('rating 95 → 약 0.679', () => {
    expect(calculateRatingScore({ rating: 95 })).toBeCloseTo(0.679, 2);
  });

  it('rating 150 (이론적 최대 초과) → 1.0 clamp', () => {
    expect(calculateRatingScore({ rating: 150 })).toBe(1.0);
  });

  it('음수 입력 → 0점 (방어)', () => {
    expect(calculateRatingScore({ rating: -10 })).toBe(0);
  });
});
