/**
 * 캐치업 알림 순수 판정 — "이 날짜, 이번 시도로도 안 풀렸으니 알려야 하나".
 *
 * 어제·그저께 생긴 구멍은 시도해도 안 채워져도 조용히 넘어간다(폴러가 아직
 * 못 따라잡았을 뿐일 수 있음 — 정상 지연). STALE_THRESHOLD_DAYS일 이상 묵은
 * 구멍이 이번 시도로도 전혀 안 채워지면(재싱크 결과 racesSynced 합계 0) 알린다.
 */

/** 이보다 오래된 구멍이 이번 시도로도 안 채워지면 실패 처리(알림)한다 */
export const STALE_THRESHOLD_DAYS = 2;

export function isStaleUnresolved(
  rcDate: number,
  staleCutoff: number,
  totalSynced: number
): boolean {
  return rcDate <= staleCutoff && totalSynced === 0;
}
