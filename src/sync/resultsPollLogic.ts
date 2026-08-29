/**
 * 결과 폴러 순수 판정 — "지금 KRA를 불러야 하나"를 DB·네트워크 없이 결정한다.
 *
 * 배경: 결과 sync를 19시·23시 고정 슬롯 대신 발주시각(races.st_time) 기반으로
 * 바꾼다(2026-08-29 설계). 출마표에 이미 있는 발주시각 + 여유시간이 지났는데
 * 아직 착순이 없는 경주가 하나라도 있으면 그때만 KRA를 부른다 — 없으면 폴마다
 * KRA 쿼터를 쓰지 않는다. "미시행 가드"(dailySync)가 이미 있어 너무 일찍 불러도
 * 안전하므로, 여기서는 "부를지 말지"만 싸게 판정한다.
 */

/** races.st_time 원문 형식: "출발 :10:35" (KRA raceCardSync 원본 그대로 저장) */
export function parseStTime(stTime: string | null | undefined): number | null {
  if (!stTime) return null;
  const m = stTime.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface RaceTimingStatus {
  stTime: string | null;
  /** 이 경주에 착순(ord)이 하나라도 채워졌는지 */
  hasResult: boolean;
}

/**
 * `nowMinutes`(자정 기준 분) 시점에 KRA를 불러야 하는지.
 * 발주시각을 못 읽는 경주(null·파싱 실패)는 판단 근거가 없으므로 대상에서 뺀다
 * — 잘못 당겨 쓰는 대신 다음 폴로 미룬다(캐치업이 최종 안전망).
 */
export function hasDueUnsyncedRace(
  races: RaceTimingStatus[],
  nowMinutes: number,
  bufferMinutes: number
): boolean {
  return races.some((r) => {
    if (r.hasResult) return false;
    const post = parseStTime(r.stTime);
    if (post == null) return false;
    return post + bufferMinutes <= nowMinutes;
  });
}
