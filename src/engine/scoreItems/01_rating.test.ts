import { describe, it, expect } from 'vitest';
import { calculateRatingScore } from './01_rating';

describe('① 레이팅 — fallback (allRaceRatings 없음)', () => {
  it('rating 0 (미등급) → 0.5 중립', () => {
    expect(calculateRatingScore({ rating: 0 })).toBe(0.5);
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

  it('음수 입력 → 0.5 중립', () => {
    expect(calculateRatingScore({ rating: -10 })).toBe(0.5);
  });
});

describe('① 레이팅 — 경주 내 상대 순위 (allRaceRatings 있음)', () => {
  it('미등급 말 → 0.5 중립 (경주에 등급 말 있어도)', () => {
    // 경주: [0, 0, 60, 80, 100]
    const allRaceRatings = [0, 0, 60, 80, 100];
    expect(calculateRatingScore({ rating: 0, allRaceRatings })).toBe(0.5);
  });

  it('최상위 등급 → 1.0', () => {
    const allRaceRatings = [0, 0, 60, 80, 100];
    expect(calculateRatingScore({ rating: 100, allRaceRatings })).toBe(1.0);
  });

  it('최하위 등급 → 0.0', () => {
    const allRaceRatings = [0, 0, 60, 80, 100];
    expect(calculateRatingScore({ rating: 60, allRaceRatings })).toBe(0.0);
  });

  it('중간 등급 → 0.5', () => {
    const allRaceRatings = [0, 0, 60, 80, 100];
    expect(calculateRatingScore({ rating: 80, allRaceRatings })).toBe(0.5);
  });

  it('경주 내 유일 등급 말 → 0.75', () => {
    const allRaceRatings = [0, 0, 0, 50, 0];
    expect(calculateRatingScore({ rating: 50, allRaceRatings })).toBe(0.75);
  });

  it('전원 미등급 경주 — 미등급 말 → 0.5', () => {
    const allRaceRatings = [0, 0, 0, 0];
    expect(calculateRatingScore({ rating: 0, allRaceRatings })).toBe(0.5);
  });

  it('동점 처리: 동일 레이팅 말은 같은 점수', () => {
    const allRaceRatings = [50, 50, 100];
    // rating=50: betterCount=1 (100이 더 높음), n=3, score = 1 - 1/2 = 0.5
    expect(calculateRatingScore({ rating: 50, allRaceRatings })).toBe(0.5);
    expect(calculateRatingScore({ rating: 100, allRaceRatings })).toBe(1.0);
  });
});
