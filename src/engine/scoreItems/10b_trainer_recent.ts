/**
 * 항목 ⑩b 조교사 최근 3개월형
 * 비중: 2.50점 / 100
 *
 * 알고리즘:
 *   - race_entries에서 최근 90일 해당 조교사 착순 배열
 *   - 복승률 (1~2등 / 전체)
 *   - 데이터 없음: 0.5 중립
 */

export interface TrainerRecentInput {
  /** 해당 조교사 마방의 최근 90일 모든 경주 착순 */
  recentOrds: number[];
}

export function calculateTrainerRecentScore(input: TrainerRecentInput): number {
  const { recentOrds } = input;
  if (!recentOrds || recentOrds.length === 0) return 0.5;

  const total = recentOrds.length;
  const top2 = recentOrds.filter((o) => o <= 2).length;

  return top2 / total;
}
