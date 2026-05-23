/**
 * 항목 ④ 구간 시간 단축
 * 비중: 2.37점 / 100
 *
 * 알고리즘 (옵션 C 정교):
 *   - 같은 거리/주로 우선
 *   - 부족 시 같은 거리만 (confidence 0.7)
 *   - 전체 시간 60% + 마지막 펄롱 40%
 *   - 0.5초 임계값
 */

export interface SectionalTimeInput {
  /** 같은 거리/주로 경주의 시간 데이터 (첫 번째가 최근) */
  sameDistTrackTimes: Array<{ rcTime: number; lastFurlong: number }>;
  /** 같은 거리만 (fallback용) */
  sameDistOnlyTimes: Array<{ rcTime: number; lastFurlong: number }>;
}

function timeToScore(improvement: number, threshold: number): number {
  if (improvement >= threshold) return 1.0;
  if (improvement >= threshold * 0.5) return 0.8;
  if (improvement >= 0) return 0.6;
  if (improvement >= -threshold * 0.5) return 0.4;
  if (improvement >= -threshold) return 0.2;
  return 0.0;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function calculateSectionalTimeScore(input: SectionalTimeInput): number {
  const { sameDistTrackTimes, sameDistOnlyTimes } = input;

  let races = sameDistTrackTimes;
  let confidence = 1.0;

  if (races.length < 2) {
    races = sameDistOnlyTimes;
    confidence = 0.7;
  }

  if (races.length < 2) return 0.5; // 데이터 부족 → 중립

  // 전체 시간 단축
  const recentTotal = races[0]!.rcTime;
  const pastTotalAvg = avg(races.slice(1).map((r) => r.rcTime));
  const totalImprove = pastTotalAvg - recentTotal; // 양수 = 향상

  // 마지막 펄롱 시간 단축
  const recentLast = races[0]!.lastFurlong;
  const pastLastAvg = avg(races.slice(1).map((r) => r.lastFurlong));
  const lastImprove = pastLastAvg - recentLast;

  const totalScore = timeToScore(totalImprove, 0.5);
  const lastScore = timeToScore(lastImprove, 0.3);

  return (totalScore * 0.6 + lastScore * 0.4) * confidence;
}
