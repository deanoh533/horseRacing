/**
 * 항목 ② 마체중 변화
 * 비중: 4.21점 / 100
 *
 * 알고리즘 (연구 조사 + 사용자 노하우):
 *   - 변화량 절대값 기반
 *   - 추세 보너스 (5경주 일관된 방향)
 *   - 계절 보정 (성별별)
 *
 * 데이터 부족: 데뷔전 → 0.5
 */

export interface WeightChangeInput {
  /** 최근 5경주의 마체중 변화량 (kg). 첫 번째가 가장 최근 경주 */
  weightDiffs: number[];
  /** 말 성별: "수" / "거" / "암" */
  sex?: string;
  /** 현재 월 (1-12), 계절 보정용 */
  currentMonth?: number;
}

export function calculateWeightChangeScore(input: WeightChangeInput): number {
  const { weightDiffs, sex, currentMonth } = input;
  if (!weightDiffs || weightDiffs.length === 0) return 0.5;

  // 1. 최근 변화량 기본 점수
  const latestChange = Math.abs(weightDiffs[0] ?? 0);
  let baseScore: number;
  if (latestChange <= 2) baseScore = 1.0; // 정상 변동 (만점)
  else if (latestChange <= 5) baseScore = 0.8; // 양호한 증감
  else if (latestChange <= 9) baseScore = 0.4; // 주의
  else baseScore = 0.1; // 위험 (10kg 이상)

  // 2. 추세 보정
  let trendBonus = 0;
  if (weightDiffs.length >= 3) {
    const isConsistent = checkConsistentTrend(weightDiffs);
    trendBonus = isConsistent ? +0.15 : -0.15;
  }

  // 3. 계절 보정
  let seasonalBonus = 0;
  if (sex && currentMonth && weightDiffs[0] !== undefined && weightDiffs[0] < 0) {
    if (sex === '암' && [3, 4, 5].includes(currentMonth)) {
      seasonalBonus = 0.1; // 봄 자연 감소 (암말)
    } else if (
      (sex === '수' || sex === '거') &&
      [6, 7, 8].includes(currentMonth)
    ) {
      seasonalBonus = 0.1; // 여름 자연 감소 (수말/거세마)
    }
  }

  return Math.max(0, Math.min(1, baseScore + trendBonus + seasonalBonus));
}

/**
 * 변화량 추세가 일관적인지 (모두 같은 방향)
 */
function checkConsistentTrend(diffs: number[]): boolean {
  const nonZero = diffs.filter((d) => d !== 0);
  if (nonZero.length < 2) return false;
  const allPositive = nonZero.every((d) => d > 0);
  const allNegative = nonZero.every((d) => d < 0);
  return allPositive || allNegative;
}
