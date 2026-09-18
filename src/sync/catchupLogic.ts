/**
 * 캐치업 알림 순수 판정 — "이 날짜, 이번 시도로도 안 풀렸으니 알려야 하나".
 *
 * 어제·그저께 생긴 구멍은 시도해도 안 채워져도 조용히 넘어간다(폴러가 아직
 * 못 따라잡았을 뿐일 수 있음 — 정상 지연). STALE_THRESHOLD_DAYS일 이상 묵은
 * 구멍이 이번 시도로도 전혀 안 채워지면(재싱크 결과 racesSynced 합계 0) 알린다.
 */

import type { SyncDateStatus } from '../utils/syncHealth.js';

/**
 * 캐치업이 다시 받을 날짜인가. 결과 구멍(hole·gap)에 더해 조합배당 구멍(partial)도
 * 대상이다 — 재싱크(syncDay)가 끝난 경주의 조합배당을 전부 다시 받으므로 한 번에 메워진다.
 * (2026-09-18 전엔 partial을 안 봐서, 조합배당만 빠진 경주는 영구로 남을 수 있었다.)
 */
export function isCatchupTarget(status: SyncDateStatus): boolean {
  return status === 'hole' || status === 'gap' || status === 'partial';
}

/** 이보다 오래된 구멍이 이번 시도로도 안 채워지면 실패 처리(알림)한다 */
export const STALE_THRESHOLD_DAYS = 2;

export function isStaleUnresolved(
  rcDate: number,
  staleCutoff: number,
  totalSynced: number
): boolean {
  return rcDate <= staleCutoff && totalSynced === 0;
}
