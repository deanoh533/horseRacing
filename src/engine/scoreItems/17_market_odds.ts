/**
 * 항목 ⑰ 배당률 (인기도)
 * 비중: 8.77점 / 100
 *
 * 알고리즘 (PRD v3.1 - winOdds 정렬 기반):
 *   - 최근 5경주에서 1~2인기 횟수
 *   - 인기도는 winOdds 오름차순 정렬로 계산
 *   - 이력 0 → 0점 (시장 인정 없음)
 */

export interface MarketOddsInput {
  /** 최근 5경주의 인기 순위 (1=1인기, 2=2인기, ...) */
  recent5Popularities: number[];
}

export function calculateMarketOddsScore(input: MarketOddsInput): number {
  const { recent5Popularities } = input;
  if (!recent5Popularities || recent5Popularities.length === 0) return 0;

  const usedRecent = recent5Popularities.slice(-5);
  const top2Count = usedRecent.filter((p) => p <= 2).length;
  return top2Count / usedRecent.length;
}
