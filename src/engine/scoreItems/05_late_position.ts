/**
 * 항목 ⑤ 후반 구간 순위 (지구력 + 선두형 가점)
 * 비중: 2.37점 / 100
 *
 * 알고리즘:
 *   - 마지막 펄롱 순위 점수: 80%
 *   - 변화 보너스 (스타일): 20%
 *   - 선두형 유지 (1→1)도 가점 (사용자 피드백)
 *   - 최근 가중치 적용
 */

export interface LatePositionInput {
  /** 최근 5경주의 (1펄롱 순위, 마지막 펄롱 순위) */
  positions: Array<{ startOrd: number; finishOrd: number }>;
}

const ORD_MAP: Record<number, number> = { 1: 100, 2: 80, 3: 60, 4: 40, 5: 20 };
const WEIGHTS = [0.4, 0.25, 0.15, 0.1, 0.1]; // 최근 우선

export function calculateLatePositionScore(input: LatePositionInput): number {
  const { positions } = input;
  if (!positions || positions.length === 0) return 0.5;

  const scores = positions.map((p) => {
    if (!p.startOrd || !p.finishOrd) return 50;

    // 마지막 펄롱 순위 점수 (80%)
    const finishScore = ORD_MAP[p.finishOrd] ?? 0;

    // 변화 보너스 (20%)
    const change = p.startOrd - p.finishOrd; // 양수 = 추월
    let changeBonus: number;
    if (change >= 3) changeBonus = 100; // 강한 추월
    else if (change >= 1) changeBonus = 50; // 보통 추월
    else if (change === 0) changeBonus = 30; // 위치 유지 (선두형 가점)
    else if (change >= -1) changeBonus = -30;
    else if (change >= -3) changeBonus = -70;
    else changeBonus = -100;

    return Math.max(0, Math.min(100, finishScore * 0.8 + changeBonus * 0.2));
  });

  // 가중 평균
  const usedWeights = WEIGHTS.slice(0, scores.length);
  const weightSum = usedWeights.reduce((s, w) => s + w, 0);
  const weightedAvg =
    scores.reduce((sum, s, i) => sum + s * (usedWeights[i] ?? 0), 0) /
    weightSum;

  return weightedAvg / 100;
}
