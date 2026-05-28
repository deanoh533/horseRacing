/**
 * 항목 ⑨b 기수 최근 3개월형
 * 비중: 4.00점 / 100
 *
 * 알고리즘:
 *   - race_entries에서 최근 90일 해당 기수 착순 배열
 *   - 단승률 (1등 / 전체)
 *   - 데이터 없음: 0.5 중립
 */

export interface JockeyRecentInput {
  /** 해당 기수의 최근 90일 모든 경주 착순 */
  recentOrds: number[];
}

export function calculateJockeyRecentScore(input: JockeyRecentInput): number {
  const { recentOrds } = input;
  if (!recentOrds || recentOrds.length === 0) return 0.5;

  const total = recentOrds.length;
  const wins = recentOrds.filter((o) => o === 1).length;

  return wins / total;
}
