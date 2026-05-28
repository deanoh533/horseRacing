/**
 * 항목 ① 레이팅
 * 비중: 6.00점 / 100 (T-015 기준 재산정)
 *
 * 규칙: 경주 내 상대 순위 (T-015)
 * - 미등급(0/null): 0.5 (중립 — 알 수 없음)
 * - 등급 말: 같은 경주 내 등급 말들 중 percentile (0.0 ~ 1.0)
 * - allRaceRatings 없으면 절대값 rating/140 fallback
 */

export interface RatingInput {
  rating: number;
  allRaceRatings?: number[];  // 같은 경주 전 출전마 레이팅 (0 = 미등급)
}

export function calculateRatingScore(input: RatingInput): number {
  const { rating, allRaceRatings } = input;

  // Fallback: 경주 컨텍스트 없으면 절대값
  if (!allRaceRatings || allRaceRatings.length < 2) {
    if (!rating || rating <= 0) return 0.5;
    return Math.min(1.0, rating / 140);
  }

  // 미등급 말 → 중립
  if (!rating || rating <= 0) return 0.5;

  // 등급 말들만 추려서 경주 내 순위 계산
  const ratedInRace = allRaceRatings.filter(r => r > 0);
  if (ratedInRace.length === 1) return 0.75; // 경주 내 유일 등급 말

  const n = ratedInRace.length;
  const betterCount = ratedInRace.filter(r => r > rating).length;
  return 1.0 - betterCount / (n - 1);
}
