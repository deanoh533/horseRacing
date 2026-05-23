/**
 * 항목 ⑦ 주로 적응 (향상도 기반)
 * 비중: 8.77점 / 100
 *
 * 알고리즘 (PRD v4.0 유지):
 *   - 향상도 = 전체 평균 착순 - 해당 주로 평균 착순
 *   - 양수 = 이 주로에서 평소보다 강함
 *   - 5단계 임계값
 *
 * 데이터 부족:
 *   - 같은 주로 이력 0개 → 0.5
 *   - 전체 데이터 < 3 → 0.5
 */

export interface TrackAdaptationInput {
  /** 말의 전체 이력 착순 */
  overallOrds: number[];
  /** 오늘 주로 종류와 같은 경주의 착순 */
  sameTrackOrds: number[];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function calculateTrackAdaptationScore(
  input: TrackAdaptationInput
): number {
  const { overallOrds, sameTrackOrds } = input;

  if (!sameTrackOrds || sameTrackOrds.length === 0) return 0.5;
  if (!overallOrds || overallOrds.length < 3) return 0.5;

  const overallAvg = avg(overallOrds);
  const sameTrackAvg = avg(sameTrackOrds);
  const improvement = overallAvg - sameTrackAvg; // 양수 = 이 주로에서 좋음

  if (improvement >= 2.0) return 1.0; // 매우 강함
  if (improvement >= 1.0) return 0.75; // 강함
  if (improvement >= 0) return 0.5; // 평균
  if (improvement >= -1.0) return 0.25; // 약함
  return 0.0; // 매우 약함
}
