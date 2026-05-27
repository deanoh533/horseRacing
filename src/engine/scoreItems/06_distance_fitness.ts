/**
 * 항목 ⑥ 거리 적성
 * 비중: 8.77점 / 100
 *
 * 알고리즘:
 *   [primary] horse_running_style_by_distance.avg_finish_ratio
 *     점수 = 1 - avg_finish_ratio  (출전두수 정규화됨)
 *   [fallback] 같은 거리 착순 차등 점수 (데이터 없을 때)
 *     1등=3, 2등=2, 3등=1, 4+=0 → 합계 / (경주수 × 3)
 *
 * 핵심:
 *   ratio primary: 5마 1등 ≠ 14마 1등 — 출전두수 보정
 *   fallback: 2번 1등(0.40) > 5번 3등(0.33) — 우승력 우선
 */

export interface DistanceFitnessInput {
  /** 말의 같은 거리 경주 이력 착순 (fallback) */
  sameDistOrds: number[];
  /** horse_running_style_by_distance.avg_finish_ratio (primary, 있으면 우선) */
  distFinishRatio?: number | null;
}

const ORD_VALUE_MAP: Record<number, number> = {
  1: 3,
  2: 2,
  3: 1,
};

export function calculateDistanceFitnessScore(
  input: DistanceFitnessInput
): number {
  const { sameDistOrds, distFinishRatio } = input;

  if (distFinishRatio != null) {
    return Math.max(0, Math.min(1, 1 - distFinishRatio));
  }

  if (!sameDistOrds || sameDistOrds.length === 0) {
    return 0.5;
  }

  const totalValue = sameDistOrds.reduce(
    (sum, ord) => sum + (ORD_VALUE_MAP[ord] ?? 0),
    0
  );
  const maxPossible = sameDistOrds.length * 3;

  return totalValue / maxPossible;
}
