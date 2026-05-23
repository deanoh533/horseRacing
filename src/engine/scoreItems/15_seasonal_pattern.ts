/**
 * 항목 ⑮ 계절 패턴
 * 비중: 4.39점 / 100
 *
 * 알고리즘 (PRD 그대로):
 *   - 최근 1년 같은 시즌 경주만
 *   - 3위 이내 비율
 *   - 시즌: 4-9월 여름 / 10-3월 겨울
 */

export interface SeasonalPatternInput {
  /** 최근 1년 같은 시즌(여름/겨울) 경주 착순 */
  sameSeasonOrds: number[];
}

export function calculateSeasonalPatternScore(
  input: SeasonalPatternInput
): number {
  const { sameSeasonOrds } = input;
  if (!sameSeasonOrds || sameSeasonOrds.length === 0) return 0.5; // 중립

  const top3Count = sameSeasonOrds.filter((o) => o <= 3).length;
  return top3Count / sameSeasonOrds.length;
}
