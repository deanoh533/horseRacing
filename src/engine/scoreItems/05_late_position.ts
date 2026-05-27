/**
 * 항목 ⑤ 후반 구간 순위 (Step 2 — 확장판)
 * 비중: 2.37점 / 100
 *
 * 알고리즘 (옵션 C 보강):
 *   - position_ratio 사용: 출전두수 정규화 (5마 1등 vs 14마 1등 공평 비교)
 *   - 3시점 분석: s1f → g1f → ord (가능 시), 아니면 s1f → ord
 *   - front_run_success_rate를 선행 후보 말에 multiplier로 적용
 *     (선행 잘하는 말은 + 보너스, 선행 후 후퇴하는 말은 - 페널티)
 *   - 최근 가중치
 *
 * ChatGPT 도메인 인사이트 + 우리 데이터(3,551마) 검증 반영.
 */

export interface PositionData {
  /** 초반 200m 순위 (s1f_ord) */
  startOrd: number;
  /** 결승선 순위 (ord) */
  finishOrd: number;
  /** 그 경주 출전두수 (ratio 정규화용). 2 이상이어야 의미 있음. */
  fieldSize: number;
  /** 종반 200m 순위 (g1f_ord). 없으면 2시점만 분석 */
  g1fOrd?: number;
}

export interface LatePositionInput {
  /** 최근 5경주의 위치 데이터 (첫 번째가 최근) */
  positions: PositionData[];
  /** 통산 선행 성공률 (출발 상위 30% → 결승 상위 30% 비율). 0~1 */
  frontRunSuccessRate?: number;
}

const WEIGHTS = [0.4, 0.25, 0.15, 0.1, 0.1]; // 최근 우선

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function positionRatio(ord: number, fieldSize: number): number | null {
  if (fieldSize < 2 || ord < 1) return null;
  return (ord - 1) / (fieldSize - 1);
}

/**
 * 한 경주의 점수 (0~1)
 */
function scoreOneRace(p: PositionData): number | null {
  const startR = positionRatio(p.startOrd, p.fieldSize);
  const finishR = positionRatio(p.finishOrd, p.fieldSize);
  if (startR === null || finishR === null) return null;

  // 1. finishScore: 결승 ratio 낮을수록 (앞일수록) 점수 ↑
  const finishScore = 1 - finishR; // 0 (꼴등) ~ 1 (1등)

  // 2. gainScore: 위치 변화
  let gainScore: number;
  if (p.g1fOrd != null && p.g1fOrd >= 1) {
    const midR = positionRatio(p.g1fOrd, p.fieldSize);
    if (midR === null) {
      // 2시점만
      gainScore = clamp01((startR - finishR) * 0.5 + 0.5);
    } else {
      // 3시점: 중반 추격 + 막판 가속
      const midGain = clamp01((startR - midR) * 0.5 + 0.5);
      const lateGain = clamp01((midR - finishR) * 0.5 + 0.5);
      gainScore = midGain * 0.6 + lateGain * 0.4;
    }
  } else {
    // 2시점만
    gainScore = clamp01((startR - finishR) * 0.5 + 0.5);
  }

  // 3. 결합 (finish 60% + gain 40%)
  return finishScore * 0.6 + gainScore * 0.4;
}

export function calculateLatePositionScore(input: LatePositionInput): number {
  const { positions, frontRunSuccessRate } = input;
  if (!positions || positions.length === 0) return 0.5;

  // 각 경주 점수
  const perRace: number[] = [];
  const startRatios: number[] = [];
  for (const p of positions) {
    const s = scoreOneRace(p);
    if (s === null) continue;
    perRace.push(s);
    const sr = positionRatio(p.startOrd, p.fieldSize);
    if (sr !== null) startRatios.push(sr);
  }
  if (perRace.length === 0) return 0.5;

  // 최근 가중 평균
  const usedWeights = WEIGHTS.slice(0, perRace.length);
  const weightSum = usedWeights.reduce((s, w) => s + w, 0);
  let weightedAvg =
    perRace.reduce((sum, s, i) => sum + s * (usedWeights[i] ?? 0), 0) / weightSum;

  // front_run_success_rate multiplier (선행 성향 말만)
  // 출발 평균 ratio ≤ 0.3 = 선행 후보
  if (frontRunSuccessRate != null && startRatios.length > 0) {
    const avgStartRatio =
      startRatios.reduce((s, v) => s + v, 0) / startRatios.length;
    if (avgStartRatio <= 0.3) {
      // success 0 → ×0.7, success 1 → ×1.3, 가운데 0.5 → ×1.0
      const multiplier = 0.7 + clamp01(frontRunSuccessRate) * 0.6;
      weightedAvg = clamp01(weightedAvg * multiplier);
    }
  }

  return weightedAvg;
}
