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
}

export function calculateStartingPositionScore(
  input: StartingPositionInput
): number {
  const { stOrd, totalHorses, rcDist } = input;
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
  return neutral + (relativePos - neutral) * distanceWeight;
}
