/**
 * 항목 ① 레이팅
 * 비중: 17.54점 / 100
 *
 * 규칙: rating / 140 (PRD v4.0 그대로)
 * - rating = 0 이면 6등급 미부여 → 0점
 * - 이론적 최대 140
 */

export interface RatingInput {
  rating: number;
}

export function calculateRatingScore(input: RatingInput): number {
  const { rating } = input;
  if (!rating || rating <= 0) return 0;
  return Math.min(1.0, rating / 140);
}
