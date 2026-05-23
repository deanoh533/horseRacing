/**
 * 항목 ③ 착순 추세 (컨디션 신호 2)
 * 비중: 4.21점 / 100
 *
 * 알고리즘 (사용자 5년 노하우):
 *   - 가중 평균 (최신 우선): 0.4 / 0.25 / 0.15 / 0.1 / 0.1
 *   - 착순별 점수: 1=100, 2=80, 3=60, 4=40, 5=20, 6+=0
 *   - 기세 보너스: slope < 0 = 향상 → +1~+5
 *   - 안정성 보너스: 표준편차 작을수록 → +3~+5
 *
 * 입력 형식:
 *   ord5: [가장 과거, ..., 가장 최근]
 *   (3-3-2-1-1 패턴 = [3, 3, 2, 1, 1])
 */

export interface RecentFormInput {
  /** 최근 5경주 착순 (과거 → 최근 순서) */
  ord5: number[];
}

const ORD_SCORE_MAP: Record<number, number> = {
  1: 100,
  2: 80,
  3: 60,
  4: 40,
  5: 20,
};

// 시간 순으로 인덱스 0=과거, 4=최신. 최신에 가중치 ↑
const WEIGHTS = [0.1, 0.1, 0.15, 0.25, 0.4];

export function calculateRecentFormScore(input: RecentFormInput): number {
  const { ord5 } = input;
  if (!ord5 || ord5.length === 0) return 0.5; // 데뷔전

  // 5경주 미만이면 있는 만큼만 (가중치 정규화)
  const usedOrd = ord5.slice(-5);
  const usedWeights = WEIGHTS.slice(-usedOrd.length);
  const weightSum = usedWeights.reduce((s, w) => s + w, 0);

  // 1. 가중 평균 점수
  const scores = usedOrd.map((o) => ORD_SCORE_MAP[o] ?? 0);
  const weightedAvg =
    scores.reduce((sum, score, i) => sum + score * (usedWeights[i] ?? 0), 0) /
    weightSum;

  // 2. 기세 (선형 회귀 기울기, 시간순으로 ord 변화)
  const slope = calculateSlope(usedOrd);
  const momentum =
    slope <= -1.0
      ? 5
      : slope <= -0.5
        ? 3
        : slope < 0
          ? 1
          : slope >= 1.0
            ? -5
            : slope >= 0.5
              ? -3
              : 0;

  // 3. 안정성 (표준편차)
  const stdev = calculateStdev(usedOrd);
  const stability = stdev < 1.0 ? 5 : stdev < 1.5 ? 3 : stdev > 3.0 ? -3 : 0;

  const total = weightedAvg + momentum + stability;
  return Math.max(0, Math.min(100, total)) / 100;
}

function calculateSlope(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = arr[i] ?? 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

function calculateStdev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance =
    arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}
