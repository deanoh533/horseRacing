/**
 * sync 건전성 판정 — "Actions가 초록불이었나"가 아니라 "데이터가 실제로 찼나"를 본다.
 *
 * 2026-08 점검에서 배운 것: 워크플로우 성패만 보면 구멍이 안 보인다.
 * 휴장일 실패가 섞여 빨간불이 무뎌지고, 반대로 KRA 타임아웃으로 결과가
 * 통째로 빠진 날(20260808·0814·0821)은 이력만으로 티가 안 났다.
 * 진짜 판정 기준은 경주일별 `race_entries.ord` 채움 여부.
 */

/** 경주일 하나의 sync 상태 */
export type SyncDateStatus =
  | 'ok'      // 결과 + 조합배당까지 정상
  | 'pending' // 오늘/미래 경주 — 결과가 아직 없는 게 정상
  | 'partial' // 결과는 왔는데 조합배당이 빔 (조합 수집은 실패 격리 대상)
  | 'gap'     // 일부 경주만 결과가 옴 = 부분 구멍 (재싱크 대상)
  | 'hole';   // 지난 경주인데 결과가 0건 = 데이터 구멍

export interface RaceDateCounts {
  raceDate: number;
  /** 출전마 행 수 */
  entries: number;
  /** 그중 착순(ord)이 채워진 행 수 — 제외마·기권 때문에 entries보다 작은 게 정상 */
  ordFilled: number;
  races: number;
  /**
   * 결과가 하나라도 들어온 경주 수. 두수(ordFilled)가 아니라 이 값으로 부분
   * 구멍을 판정한다 — 제외마 때문에 두수는 매일 모자라지만, 경주 수는
   * 전부 와야 정상이다.
   */
  racesWithResult: number;
  /** 발주시각이 남아 있는 경주 수 (결과 sync가 지우지 않는지 확인용) */
  stTimeFilled: number;
  comboRows: number;
}

/**
 * `today`(YYYYMMDD) 기준으로 경주일 하나를 분류한다.
 * 휴장일은 애초에 행이 생기지 않아 호출 대상에 들어오지 않는다.
 */
/**
 * 조합배당(combo_dividends) 수집이 시작된 경주일. forward-only로 도입돼
 * 이전 경주는 애초에 수집 대상이 아니다 — 여기서 걸러야 '조합배당 누락'
 * 오탐이 안 뜬다(휴장일 오탐과 같은 문제).
 */
export const COMBO_SYNC_SINCE = 20260729;

export function classifyRaceDate(c: RaceDateCounts, today: number): SyncDateStatus {
  // 오늘 경주는 저녁 결과 sync 전이거나 진행 중이라, 비어 있어도 일부만 와 있어도 정상
  if (c.raceDate >= today) return 'pending';
  if (c.ordFilled === 0) return 'hole';
  // 두수가 아니라 경주 수로 대조한다. 20260822·20260815는 19시 sync 시점에
  // 서울 R9·R10이 아직 KRA에 없어 10경주 중 8경주만 왔는데, ordFilled > 0이라
  // 기존 판정은 '정상'으로 통과시켰다. 재싱크가 채우므로 hole과 같이 안내한다.
  if (c.races > 0 && c.racesWithResult < c.races) return 'gap';
  if (c.comboRows === 0 && c.raceDate >= COMBO_SYNC_SINCE) return 'partial';
  return 'ok';
}

/**
 * 결과 sync가 발주시각(st_time)을 NULL로 덮어쓰던 버그를 고친 날.
 * 이 날짜 이전 경주는 값이 이미 사라졌고 복구할 수 없으므로(지난 출마표는
 * KRA가 주지 않는다) 회귀 감시 대상에서 뺀다.
 */
export const ST_TIME_PRESERVED_SINCE = 20260823;
