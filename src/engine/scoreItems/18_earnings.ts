/**
 * 항목 ⑱ 수득상금 (Earnings)
 * 비중: 8.77점 / 100 (초기값, 학습으로 조정)
 *
 * 도메인 통찰:
 *   KRA 상금 시스템은 강한 말에 더 큰 상금 분배 → 누적 수득상금 = 검증된 실력
 *   우리 데이터 검증: 1억+ 말 32.6% / 1000만~1억 18.6% / 1000만 미만 ~0%
 *
 * 알고리즘:
 *   - 통산 수득상금 기준 5단계 구간 매핑
 *   - 데이터 없음 → 0.5 (중립)
 */

export interface EarningsInput {
  /** 통산 수득상금 (원) */
  erngSump?: number;
}

export function calculateEarningsScore(input: EarningsInput): number {
  const e = input.erngSump;
  if (e === undefined || e === null) return 0.5; // 데이터 없음 → 중립

  if (e === 0) return 0; // 미입상
  if (e < 1_000_000) return 0.1; // 입문 (1~100만)
  if (e < 10_000_000) return 0.25; // 중수 (100~1000만)
  if (e < 100_000_000) return 0.6; // 상수 (1000만~1억)
  if (e < 500_000_000) return 0.85; // 강자 (1억~5억)
  return 1.0; // 최상위 (5억+)
}
