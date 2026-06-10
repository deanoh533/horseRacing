/**
 * 의도·전략 신호 헬퍼 (착순 우물 밖).
 * 직전 경주 등급 밴드 vs 오늘을 raw로 비교. 점수화 없음.
 * (equipDiff/기수변경은 게이트 탈락으로 제거 — 2026-06-10.)
 */

/**
 * 등급 밴드 상한 파싱. races.prize_cond = "R0~65" 형식 → 65(클래스 서열 proxy).
 * 상한이 클수록 높은 클래스(강한 필드). 숫자 없으면 null.
 */
export function parseClassBand(prizeCond: string | null | undefined): number | null {
  if (!prizeCond) return null;
  const nums = prizeCond.match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  return Number(nums[nums.length - 1]); // 마지막 숫자 = 상한
}
