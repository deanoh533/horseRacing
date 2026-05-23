/**
 * 항목 ⑨ 기수 폼
 * 비중: 10.53점 / 100
 *
 * 알고리즘 (사용자 노하우 - 안정성 우선):
 *   - 최근 30일 기수의 모든 경주
 *   - 입상 비율 (1-3등 / 전체) - 메인
 *   - 1등 가중 보너스 (× 0.2)
 *
 * 핵심:
 *   5번 입상 (꾸준) > 1번 우승 (간헐)
 *   → 안정성이 핵심 (거리 적성과 반대 패턴)
 *
 * 데이터 부족: 5회 미만 → 중립 0.5
 */

export interface JockeyFormInput {
  /** 기수의 최근 30일 모든 경주 착순 */
  recent30DayOrds: number[];
}

export function calculateJockeyFormScore(input: JockeyFormInput): number {
  const { recent30DayOrds } = input;

  if (!recent30DayOrds || recent30DayOrds.length < 5) {
    return 0.5; // 데이터 부족 → 중립
  }

  const total = recent30DayOrds.length;
  const top1 = recent30DayOrds.filter((o) => o === 1).length;
  const top3 = recent30DayOrds.filter((o) => o <= 3).length;

  // 메인: 입상 비율
  const top3Rate = top3 / total;

  // 보너스: 1등 가중
  const top1Bonus = (top1 / total) * 0.2;

  return Math.min(1.0, top3Rate + top1Bonus);
}
