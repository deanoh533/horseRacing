/**
 * sync CLI 공통 헬퍼 — 날짜 기본값 계산 + 0건(조용한 실패) 판정
 *
 * 날짜는 시스템 TZ 기준(Date 로컬 필드 사용). GitHub Actions에서는
 * 워크플로우 env `TZ: Asia/Seoul`이 이를 KST로 고정한다.
 */

/** now + offsetDays를 YYYYMMDD 정수로 반환 */
export function yyyymmddOffset(offsetDays: number, now: Date = new Date()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** 전 meet의 동기화 경주 합계가 0건인지 (--fail-on-empty 판정) */
export function isEmptySync(results: Array<{ racesSynced: number }>): boolean {
  return results.reduce((sum, r) => sum + r.racesSynced, 0) === 0;
}
