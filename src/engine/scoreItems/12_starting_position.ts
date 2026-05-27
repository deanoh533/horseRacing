/**
 * 항목 ⑫ 출발번호 (실제 stOrd)
 * 비중: 2.63점 / 100
 *
 * 알고리즘 (PRD v2.3 그대로):
 *   - 상대 위치 = (출전두수 - stOrd) / (출전두수 - 1)
 *   - 거리별 가중치 (단거리 100%, 중거리 50%, 장거리 20%)
 *   - 중립값(0.5)으로 수렴
 */

export interface StartingPositionInput {
  /** 실제 출발번호 (racedetailresult의 stOrd) */
  stOrd: number;
  /** 출전 두수 */
  totalHorses: number;
  /** 경주 거리 (m) */
  rcDist: number;
  /** 주행 성향 multiplier용 (horse_sectional_ability view) */
  avgPositionRatio?: number | null;
  /** 자유마 판정용 (horse_sectional_ability view) */
  stddevPositionRatio?: number | null;
}

/**
 * 주행 성향 분류 임계값 (한국 경마 표준)
 *   자유마: stddev_position_ratio ≥ 0.35 (불안정) — 우선 판정
 *   도주마: avg_position_ratio ≤ 0.15
 *   선행마: 0.15 < avg ≤ 0.35
 *   선입마: 0.35 < avg ≤ 0.65
 *   추입마: avg > 0.65
 */
function getRunningStyleMultiplier(
  avgPositionRatio?: number | null,
  stddevPositionRatio?: number | null
): number {
  if (avgPositionRatio == null) return 1.0; // 데이터 없음 → 기본
  if (stddevPositionRatio != null && stddevPositionRatio >= 0.35) return 1.0; // 자유마
  if (avgPositionRatio <= 0.15) return 1.5; // 도주마
  if (avgPositionRatio > 0.65) return 0.5; // 추입마
  return 1.0; // 선행·선입
}

export function calculateStartingPositionScore(
  input: StartingPositionInput
): number {
  const { stOrd, totalHorses, rcDist, avgPositionRatio, stddevPositionRatio } = input;
  if (!stOrd || totalHorses <= 1) return 0.5;

  // 상대 위치 (1.0 = 가장 내곽, 0 = 가장 외곽)
  const relativePos = (totalHorses - stOrd) / (totalHorses - 1);

  // 거리별 가중치 (단거리일수록 영향 큼)
  let distanceWeight: number;
  if (rcDist <= 1400) distanceWeight = 1.0; // 단거리
  else if (rcDist <= 1700) distanceWeight = 0.5; // 중거리
  else distanceWeight = 0.2; // 장거리

  // 중립값(0.5)으로 수렴
  const neutral = 0.5;
  const baseScore = neutral + (relativePos - neutral) * distanceWeight;

  // 주행 성향 multiplier 적용 후 [0, 1] 클램프
  const multiplier = getRunningStyleMultiplier(avgPositionRatio, stddevPositionRatio);
  return Math.max(0, Math.min(1, baseScore * multiplier));
}
