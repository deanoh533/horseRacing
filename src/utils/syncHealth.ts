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
  | 'partial' // 결과는 왔는데 조합배당이 (일부 경주라도) 빔 — 조합 수집은 실패 격리라 따로 메워야 함
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
  /**
   * 결과가 있는 경주 중 조합배당도 있는 경주 수. 날짜 전체 comboRows만 보면
   * 경주 몇 개만 빠진 걸 못 잡는다(2026-09-18 — 마지막 결과를 받은 폴러에서
   * 조합배당만 실패하면 그 뒤로 아무도 다시 안 받는다).
   */
  racesWithCombo: number;
  /** 발주시각이 남아 있는 경주 수 (결과 sync가 지우지 않는지 확인용) */
  stTimeFilled: number;
  comboRows: number;
  /**
   * 이 경주일 출마표를 **마지막으로** 수집한 시각(ISO). 아직 판정에는 안 쓰고
   * 관측만 한다 — 출마표 잡은 수·목·금 하루 1회라 실패가 곧 손실인데
   * (2026-09-17 실측), 며칠 묵었는지를 볼 데이터가 그동안 없었다.
   * 재실행이 실제로 무엇을 갱신하는지 실측한 뒤 판정에 넣을지 정한다(TODO O-008).
   */
  cardFetchedAt: string | null;
  /**
   * 그날 경주가 있었던 경마장 코드들. 구멍 판정에는 안 쓰고 **경마장이 통째로
   * 빠지는 변화**를 보려고 갖고 있는다 — 2026-09-13 영천 개장으로 일요일 부경 경주가
   * 영천으로 넘어갔는데, 우리가 meet=4를 안 불러서 2주치를 통째로 놓쳤다.
   * `races` 행이 아예 없으니 기존 판정에는 휴장일과 똑같이 보였다.
   */
  meets: number[];
}

/** YYYYMMDD → 요일 (0=일) */
export function weekdayOf(raceDate: number): number {
  return new Date(Date.UTC(
    Math.floor(raceDate / 10000),
    Math.floor((raceDate % 10000) / 100) - 1,
    raceDate % 100
  )).getUTCDay();
}

/** 경마장 구성이 바뀐 날 */
export interface VenueChange {
  raceDate: number;
  /** 직전 같은 요일엔 있었는데 이번엔 없는 경마장 */
  missing: number[];
  /** 직전 같은 요일엔 없었는데 새로 생긴 경마장 */
  added: number[];
  comparedTo: number;
}

/**
 * **같은 요일끼리** 비교해 경마장 구성이 바뀐 날을 찾는다.
 *
 * "금=부경·토=서울·일=서울+영천" 같은 일정표를 코드에 박으면 다음 개편 때 또 못 잡는다
 * — 이번에 놓친 이유가 정확히 그거다. 그래서 일정표 대신 **직전 같은 요일과의 차이**만 본다.
 * 개편은 한 번만 경고하고 새 구성이 기준이 된다.
 */
export function venueChanges(
  dates: Array<{ raceDate: number; meets: number[] }>
): VenueChange[] {
  const sorted = [...dates].sort((a, b) => a.raceDate - b.raceDate);
  const lastByWeekday = new Map<number, { raceDate: number; meets: number[] }>();
  const out: VenueChange[] = [];

  for (const d of sorted) {
    const wd = weekdayOf(d.raceDate);
    const prev = lastByWeekday.get(wd);
    if (prev) {
      const now = new Set(d.meets);
      const before = new Set(prev.meets);
      const missing = [...before].filter((m) => !now.has(m)).sort();
      const added = [...now].filter((m) => !before.has(m)).sort();
      if (missing.length > 0 || added.length > 0) {
        out.push({ raceDate: d.raceDate, missing, added, comparedTo: prev.raceDate });
      }
    }
    lastByWeekday.set(wd, d);
  }
  return out;
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
  if (c.raceDate >= COMBO_SYNC_SINCE && (c.comboRows === 0 || c.racesWithCombo < c.racesWithResult)) {
    return 'partial';
  }
  return 'ok';
}

/**
 * `race_entries.fetched_at`이 **마지막** 출마표 수집 시각이 된 날.
 * 이전에는 DB 기본값(`DEFAULT NOW()`)에만 의존해 INSERT에만 찍혔다 — 그래서
 * 이 날짜 이전 경주일의 값은 최초 수집 시각이고, 신선도가 실제보다 나빠 보인다.
 */
export const CARD_FETCH_TRACKED_SINCE = 20260921;

/**
 * 출마표를 경주 며칠 전에 마지막으로 받았는지 (KST 달력 일수).
 * 3이면 "경주 3일 전 수집이 마지막" = 그 뒤 재실행이 한 번도 안 돌았다는 뜻.
 * 출마표는 수요일에 금·토·일 3일치가 한 번에 발표되므로, 목·금 재실행이 정상이면
 * 금=D-0~2 · 토=D-1~3 · 일=D-2~4 범위로 줄어든다.
 *
 * `fetched_at`이 없으면(결과만 백필된 과거 행) null.
 */
export function cardAgeDays(cardFetchedAt: string | null, raceDate: number): number | null {
  if (!cardFetchedAt) return null;
  const t = Date.parse(cardFetchedAt);
  if (Number.isNaN(t)) return null;
  // UTC+9로 옮긴 뒤 UTC 달력으로 읽으면 KST 날짜가 된다
  const kst = new Date(t + 9 * 3600_000);
  const fetchedUtcDay = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const raceUtcDay = Date.UTC(
    Math.floor(raceDate / 10000),
    Math.floor((raceDate % 10000) / 100) - 1,
    raceDate % 100
  );
  return Math.round((raceUtcDay - fetchedUtcDay) / 86400_000);
}

/**
 * 결과 sync가 발주시각(st_time)을 NULL로 덮어쓰던 버그를 고친 날.
 * 이 날짜 이전 경주는 값이 이미 사라졌고 복구할 수 없으므로(지난 출마표는
 * KRA가 주지 않는다) 회귀 감시 대상에서 뺀다.
 */
export const ST_TIME_PRESERVED_SINCE = 20260823;
