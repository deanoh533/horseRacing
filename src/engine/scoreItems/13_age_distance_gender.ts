/**
 * 항목 ⑬ 나이 × 거리 × 성별
 * 비중: 2.63점 / 100
 * 상태: ⏸ 전문가 자문 대기 (임시 매트릭스)
 *
 * 알고리즘 (임시 - PRD 그대로):
 *   - 거리 구간별 나이 매트릭스
 *   - 성별 보정 (암말)
 */

export interface AgeDistanceGenderInput {
  age: number;
  sex: string; // "수" | "거" | "암"
  rcDist: number;
}

type DistCategory = 'short' | 'medShort' | 'medium' | 'medLong' | 'long';

// 나이-거리 매트릭스 (전문가 자문 후 변경)
const AGE_DIST_MATRIX: Record<number, Record<DistCategory, number>> = {
  3: { short: 1.0, medShort: 0.8, medium: 0.6, medLong: 0.4, long: 0.0 },
  4: { short: 0.9, medShort: 0.9, medium: 0.8, medLong: 0.6, long: 0.4 },
  5: { short: 0.7, medShort: 0.8, medium: 0.9, medLong: 0.9, long: 0.7 },
  6: { short: 0.5, medShort: 0.6, medium: 0.8, medLong: 1.0, long: 1.0 },
};

function getDistCategory(rcDist: number): DistCategory {
  if (rcDist <= 1200) return 'short';
  if (rcDist <= 1400) return 'medShort';
  if (rcDist <= 1600) return 'medium';
  if (rcDist <= 1800) return 'medLong';
  return 'long';
}

export function calculateAgeDistanceGenderScore(
  input: AgeDistanceGenderInput
): number {
  const { age, sex, rcDist } = input;
  const distCategory = getDistCategory(rcDist);

  // 7세+ = 6세 동일
  const ageKey = Math.min(Math.max(age, 3), 6);
  let baseScore = AGE_DIST_MATRIX[ageKey]?.[distCategory] ?? 0.5;

  // 성별 보정 (암말)
  if (sex === '암') {
    if (['short', 'medShort', 'medium'].includes(distCategory)) {
      baseScore = Math.min(1.0, baseScore * 1.1);
    } else {
      baseScore = baseScore * 0.9;
    }
  }

  return baseScore;
}
