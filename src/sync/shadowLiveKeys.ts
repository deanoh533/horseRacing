/**
 * 이미 사전 저장된(live) 섀도 예측이 있는 경주 키 집합 — 페이지네이션 안전.
 * PostgREST 기본 1000행 캡을 넘는 라이브 행이 있어도(경주당 여러 마리 = 여러 행)
 * 전부 순회해야 shadow_backfill이 그 경주를 건너뛰고, writeShadowPredictions가
 * source='live' 행을 backfill로 덮어쓰지 않는다 (spec §4.4).
 */
export interface LiveKeyRow {
  race_date: number;
  meet: number;
  rc_no: number;
}

export async function fetchLiveShadowKeys(
  fetchPage: (offset: number, limit: number) => Promise<LiveKeyRow[]>,
  pageSize = 1000,
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let off = 0; ; off += pageSize) {
    const page = await fetchPage(off, pageSize);
    for (const r of page) keys.add(`${r.race_date}-${r.meet}-${r.rc_no}`);
    if (page.length < pageSize) break;
  }
  return keys;
}
