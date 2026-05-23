/**
 * 항목 ⑯ 기수-말 궁합
 * 비중: 3.51점 / 100
 *
 * 알고리즘:
 *   - 최근 1년 데이터만
 *   - 향상도 = 말의 전체 평균 - 이 기수 조합 평균
 *   - 신뢰도 계수: 1회=0.5, 2회=0.7, 3회=0.85, 4회=0.95, 5회+=1.0
 *   - 최종: 0.5 + (향상도 점수 - 0.5) × 신뢰도
 *
 * 데이터 부족:
 *   - 조합 0회: 0.5 (처음 조합)
 *   - 말 데이터 < 3: 0.5
 */

export interface ChemistryInput {
  /** 말의 1년 내 모든 경주 착순 */
  horseAllOrds: number[];
  /** 이 기수와의 조합 1년 내 경주 착순 */
  combinationOrds: number[];
}

const TRUST_MAP: Record<number, number> = {
  1: 0.5,
  2: 0.7,
  3: 0.85,
  4: 0.95,
};

export function calculateChemistryScore(input: ChemistryInput): number {
  const { horseAllOrds, combinationOrds } = input;

  if (!combinationOrds || combinationOrds.length === 0) return 0.5;
  if (!horseAllOrds || horseAllOrds.length < 3) return 0.5;

  const overallAvg = avg(horseAllOrds);
  const combinationAvg = avg(combinationOrds);
  const improvement = overallAvg - combinationAvg; // 양수 = 좋음

  const trust = TRUST_MAP[combinationOrds.length] ?? 1.0;
  const improvementScore = mapImprovement(improvement);

  return 0.5 + (improvementScore - 0.5) * trust;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function mapImprovement(imp: number): number {
  if (imp >= 2) return 1.0;
  if (imp >= 1) return 0.8;
  if (imp >= 0) return 0.6;
  if (imp >= -1) return 0.4;
  return 0.2;
}
