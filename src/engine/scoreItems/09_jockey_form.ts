/**
 * 항목 ⑨ 기수 통산 성적
 * 비중: 10.53점 / 100
 *
 * 알고리즘:
 *   - jockey_stats.qu_rate_t (통산 입상률 %) — 메인
 *   - jockey_stats.win_rate_t (통산 단승률 %) — 보너스 × 0.2
 *
 * 정규화: qu_rate_t / 100 (%, 그대로 0~1 스케일로 사용)
 * 데이터 없음(신인 등): 중립 0.5
 */

export interface JockeyFormInput {
  careerWinRate: number | null;
  careerQuRate: number | null;
}

export function calculateJockeyFormScore(input: JockeyFormInput): number {
  const { careerWinRate, careerQuRate } = input;

  if (careerQuRate == null) return 0.5;

  const quScore = careerQuRate / 100;
  const winBonus = careerWinRate != null ? (careerWinRate / 100) * 0.2 : 0;

  return Math.min(1.0, quScore + winBonus);
}
