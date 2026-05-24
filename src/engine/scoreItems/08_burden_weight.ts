/**
 * 항목 ⑧ 부담중량 — "부담 극복 지수"
 *
 * 도메인 통찰 (사용자 제공):
 *   KRA는 잘하는 말한테 더 무거운 짐을 매김 (handicap).
 *   → 단순히 부담중량 크다 = 강자, 작다 = 약자 가 아니라
 *   → "같은 성적이라도 더 무거운 짐 짊어진 말이 진짜 강자"
 *
 * 알고리즘:
 *   과거 N경주마다 "보정 착순" 계산:
 *     보정 착순 = 실제 착순 - (내 부담중량 - 그 경주 평균 부담중량) × α
 *
 *   예: 평균보다 +3kg 짊어지고 3위 → 보정 착순 = 3 - 3 × 0.5 = 1.5위 (사실상 강자)
 *      평균보다 -3kg 짊어지고 3위 → 보정 착순 = 3 - (-3) × 0.5 = 4.5위 (사실상 평범)
 *
 *   α = 0.5 (kg당 0.5위 보정) — 휴리스틱, 추후 학습으로 조정 가능
 *
 *   평균 보정 착순 → [0, 1] 정규화 (낮을수록 점수 ↑)
 */

const ALPHA = 0.5; // kg당 보정 강도

export interface BurdenHistoryItem {
  /** 과거 경주의 본인 실제 착순 */
  ord: number;
  /** 그 경주의 본인 부담중량 */
  myBudam: number;
  /** 그 경주 출전마 전체 평균 부담중량 */
  raceAvgBudam: number;
}

export interface BurdenWeightInput {
  /** 과거 5경주 이력 (최신순 아니어도 됨, 평균만 사용) */
  history?: BurdenHistoryItem[];
}

export function calculateBurdenWeightScore(input: BurdenWeightInput): number {
  const history = input.history ?? [];
  if (history.length === 0) return 0.5; // 데이터 없음 → 중립

  // 보정 착순 평균
  const adjustedOrds = history.map(
    (h) => h.ord - (h.myBudam - h.raceAvgBudam) * ALPHA
  );
  const avgAdjusted =
    adjustedOrds.reduce((s, v) => s + v, 0) / adjustedOrds.length;

  // 정규화: 보정 착순 1위 → 1.0, 10위 → 0.0 (선형)
  // 보정으로 음수 가능 (예: 무거운 부담으로 1위면 1 - 5 × 0.5 = -1.5위)
  // 이 경우는 1.0으로 clip
  const score = 1 - (avgAdjusted - 1) / 9;
  return Math.max(0, Math.min(1, score));
}
