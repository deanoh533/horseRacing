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

/**
 * 자동(--date 미지정) 출마표 sync 대상 날짜 목록 — 이번 주말의 남은 경주(금·토·일).
 *
 * 출마표는 수요일에 금·토·일 3일치가 한 번에 발표되므로(docs/data_lifecycle.md),
 * 각 실행일에 "발표일+2 ~ 이번 주 일요일" 범위의 경주일(금·토·일)을 모두 반환한다:
 *   수(발표일): [금, 토, 일]  ·  목: [토, 일]  ·  금: [일]
 * → 수요일에 주말 전체가 채워지고(조기 노출), 목·금 재실행이 남은 경주의
 *   임박 변경(제외마·기수교체)을 갱신한다(raceCardSync upsert 멱등).
 * 주말이 아닌 요일에 수동 실행되면 발표일+2 단일 날짜로 폴백(기존 동작 보존).
 */
export function upcomingCardDates(now: Date = new Date()): number[] {
  const FLOOR_OFFSET = 2; // 발표일+2 = 가장 이른 경주(금)
  const RACE_DOWS = new Set([5, 6, 0]); // 금·토·일 (0=일)
  const toYmd = (d: Date): number =>
    d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

  // 이번 주말의 일요일 (오늘이 일요일이면 오늘)
  const end = new Date(now);
  end.setDate(end.getDate() + ((7 - now.getDay()) % 7));
  const endYmd = toYmd(end);

  const dates: number[] = [];
  const cur = new Date(now);
  cur.setDate(cur.getDate() + FLOOR_OFFSET);
  while (toYmd(cur) <= endYmd) {
    if (RACE_DOWS.has(cur.getDay())) dates.push(toYmd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates.length > 0 ? dates : [yyyymmddOffset(FLOOR_OFFSET, now)];
}

/** 전 meet의 동기화 경주 합계가 0건인지 (--fail-on-empty 판정) */
export function isEmptySync(results: Array<{ racesSynced: number }>): boolean {
  return results.reduce((sum, r) => sum + r.racesSynced, 0) === 0;
}

/** 0건 sync의 성격 — 휴장일(정상)과 진짜 장애를 구분한다 */
export type SyncVerdict = 'synced' | 'holiday' | 'failed';

/**
 * `--fail-on-empty` 판정: 0건이라고 다 실패가 아니다.
 *
 * KRA는 경마 없는 날에도 200 + 빈 items를 정상 반환한다(혹서기 휴장 등).
 * 그 경우 에러 목록이 비어 있으므로 `holiday`로 보고 성공 종료해야
 * 빨간불이 "진짜 장애"만 뜻하게 된다. 반대로 0건이면서 에러가 있으면
 * (타임아웃·5xx) 데이터 구멍이 생긴 것이므로 `failed`.
 */
export function emptySyncVerdict(
  results: Array<{ racesSynced: number; errors: string[] }>
): SyncVerdict {
  if (results.length === 0) return 'failed'; // 아무 meet도 시도 못함
  if (!isEmptySync(results)) return 'synced';
  const hasError = results.some((r) => r.errors.length > 0);
  return hasError ? 'failed' : 'holiday';
}
