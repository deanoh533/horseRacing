/**
 * 항목 ⑪ 경주 간격
 * 비중: 3.51점 / 100
 *
 * 알고리즘:
 *   - 직전 경주와의 일수 차이
 *   - 28-35일 = 최적 (만점)
 *   - 14일 미만, 90일 초과 = 0점
 */

export interface RaceIntervalInput {
  /** 직전 경주와의 간격 (일). null = 데뷔전 */
  intervalDays: number | null;
}

export function calculateRaceIntervalScore(input: RaceIntervalInput): number {
  const { intervalDays } = input;
  if (intervalDays === null) return 0; // 데뷔전

  if (intervalDays < 14) return 0; // 너무 짧음 (피로)
  if (intervalDays <= 27) return 0.25; // 약간 짧음
  if (intervalDays <= 35) return 1.0; // 최적 (만점)
  if (intervalDays <= 60) return 0.5; // 약간 김
  if (intervalDays <= 90) return 0.25; // 김
  return 0; // 너무 김 (감각저하)
}
