/**
 * 항목 ⑭ 혈통 (3대)
 * 비중: 4.39점 / 100
 * 상태: ⏸ 전문가 자문 대기 (임시 알고리즘)
 *
 * 알고리즘 (임시):
 *   - API284의 dsa* 지수 활용
 *   - 단순 평균 후 정규화
 *
 * TODO: 부마/모마/모부마 자손들의 거리별 성적 직접 계산
 */

export interface PedigreeInput {
  /** API284의 혈통 지수 */
  dsaBriVl?: number;
  dsaClcVl?: number;
  dsaIerVl?: number;
  dsaPrfVl?: number;
  dsidxVl?: number;
}

export function calculatePedigreeScore(input: PedigreeInput): number {
  const indices = [
    input.dsaBriVl,
    input.dsaClcVl,
    input.dsaIerVl,
    input.dsaPrfVl,
    input.dsidxVl,
  ].filter((v): v is number => typeof v === 'number' && v > 0);

  if (indices.length === 0) return 0.5; // 데이터 없음

  // 평균 정규화 (KRA 지수 범위 가정 0~10)
  const avgVal = indices.reduce((s, v) => s + v, 0) / indices.length;
  return Math.min(1.0, Math.max(0, avgVal / 10));
}
