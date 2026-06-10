/**
 * 의도·전략 신호 헬퍼 (착순 우물 밖).
 * 직전 경주 속성(등급 밴드·장구) vs 오늘을 raw로 비교. 점수화 없음.
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

/**
 * 장구 변경 개수 (오늘 vs 직전 경주). 집합 차이.
 * added = 오늘 있고 직전 없던 장구 수, removed = 직전 있고 오늘 없는 수.
 */
export function equipDiff(today: string[], last: string[]): { added: number; removed: number } {
  const t = new Set(today);
  const l = new Set(last);
  let added = 0, removed = 0;
  for (const e of t) if (!l.has(e)) added++;
  for (const e of l) if (!t.has(e)) removed++;
  return { added, removed };
}
