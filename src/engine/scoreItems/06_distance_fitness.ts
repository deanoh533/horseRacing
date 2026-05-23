/**
 * 항목 ⑥ 거리 적성
 * 비중: 8.77점 / 100
 *
 * 알고리즘 (사용자 노하우 - 우승력 우선):
 *   - 같은 거리 정확 매칭만
 *   - 차등 점수: 1등=3, 2등=2, 3등=1, 4+=0
 *   - 정규화: 합계 / (경주수 × 3)
 *
 * 핵심:
 *   2번 1등 (0.40) > 5번 3등 (0.33)
 *   → 우승력이 핵심
 */

export interface DistanceFitnessInput {
  /** 말의 같은 거리 경주 이력 착순 */
  sameDistOrds: number[];
}

const ORD_VALUE_MAP: Record<number, number> = {
  1: 3,
  2: 2,
  3: 1,
};

export function calculateDistanceFitnessScore(
  input: DistanceFitnessInput
): number {
  const { sameDistOrds } = input;
  if (!sameDistOrds || sameDistOrds.length === 0) {
    return 0.5; // 이력 없음 → 중립
  }

  const totalValue = sameDistOrds.reduce(
    (sum, ord) => sum + (ORD_VALUE_MAP[ord] ?? 0),
    0
  );
  const maxPossible = sameDistOrds.length * 3;

  return totalValue / maxPossible;
}
