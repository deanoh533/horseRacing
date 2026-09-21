/**
 * Actions 실행 로그 → 운영 지표 (순수 파싱).
 *
 * 왜 로그를 까야 하나: **폴러는 KRA가 전부 실패해도 exit 0**이다(설계 — 다음 폴이
 * 메우므로 빨간불을 띄우지 않는다). 그래서 `gh run list`의 성패로는 아무것도 안 보인다.
 * 2026-09-21 전수조사에서 실행 142건이 전부 초록불인데 KRA 전멸률이 17~58%였다.
 *
 * DB로는 대신할 수 없다: `race_entries.result_at`은 폴러가 끝난 경주를 매번 다시 쓰면서
 * 덮어써서 "마지막 재작성 시각"이 된다(주말 실측: 경주별로 달라야 할 값이 18:15~18:41에
 * 전부 뭉쳤다). 결과 도착 시각은 로그의 진행 상황에서만 복원된다.
 */

/** 한 실행(잡)에서 뽑아낸 지표 */
export interface RunLogFacts {
  /** 이 실행이 KRA를 불렀는가 (폴러는 확인할 경주가 없으면 DB만 보고 끝낸다) */
  calledKra: boolean;
  /** 경마장별 동기화된 경주 수 — 누적값이다(그날 처음부터 다시 센다) */
  racesByMeet: Map<number, number>;
  /** 결과 API가 경마장 단위로 전멸한 횟수 */
  meetsAllFailed: number;
  /** 조합배당만 실패한 경주 수 (착순은 저장됨 — 다음 폴이 회수한다) */
  comboFailedRaces: number;
  /** 조합배당 응답 건수 목록 — KRA 호출 수 추정에 쓴다(1,000건/호출) */
  comboReceived: number[];
  /** 엔드포인트별 재시도 시작 횟수 (`실패(시도 1/4)` 등장 수) */
  retryStarts: Map<string, number>;
  /**
   * 출마표 잡의 날짜×경마장별 결과. 폴러와 로그 형식이 달라(`N races / M horses / K errors`)
   * 따로 받는다 — 이걸 안 보면 출마표 전멸(2026-09-17)이 "KRA 안 부름"으로 잘못 잡힌다.
   */
  cardResults: Array<{ races: number; errors: number }>;
}

/** 실행 하나의 판정 */
export type RunVerdict =
  | 'noCall'   // KRA를 안 불렀다 (확인할 경주 없음 — 정상)
  | 'allFail'  // 부른 경마장이 전부 전멸
  | 'partial'  // 착순은 받았는데 조합배당 일부 실패
  | 'ok';      // 전부 성공

const COMBO_ROWS_PER_CALL = 1000;

/**
 * 로그 본문에서 지표를 뽑는다. `gh run view --log`는 줄마다
 * `<잡 이름>\t<스텝>\t<타임스탬프> <본문>` 형식이라 앞 두 칸을 떼고 본다.
 */
export function parseRunLog(log: string): RunLogFacts {
  const facts: RunLogFacts = {
    calledKra: false,
    racesByMeet: new Map(),
    meetsAllFailed: 0,
    comboFailedRaces: 0,
    comboReceived: [],
    retryStarts: new Map(),
    cardResults: [],
  };

  for (const raw of log.split('\n')) {
    // 탭 앞 두 칸(잡 이름·스텝)과 ISO 타임스탬프를 떼어낸다
    const line = raw.split('\t').slice(2).join('\t').replace(/^﻿?\S+Z /, '');

    if (line.includes('확인할 경주 있음')) facts.calledKra = true;
    if (/❌ 전체 실패/.test(line)) facts.meetsAllFailed++;
    if (/조합배당 수집 실패/.test(line)) facts.comboFailedRaces++;

    const summary = line.match(/meet=(\d+): (\d+) 경주/);
    if (summary) {
      const meet = Number(summary[1]);
      const races = Number(summary[2]);
      // 같은 경마장이 여러 번 찍히면 마지막 값이 그 실행의 결과다
      facts.racesByMeet.set(meet, races);
    }

    const combo = line.match(/조합배당 \d+건 \(수신 (\d+)\)/);
    if (combo) facts.comboReceived.push(Number(combo[1]));

    // 출마표: "20260920 meet=1: 11 races / 120 horses / 0 errors"
    const card = line.match(/meet=\d+: (\d+) races \/ \d+ horses \/ (\d+) errors/);
    if (card) {
      facts.cardResults.push({ races: Number(card[1]), errors: Number(card[2]) });
      facts.calledKra = true;
    }

    const retry = line.match(/KRA (\S+) 실패\(시도 1\/\d+\)/);
    if (retry) {
      const ep = retry[1]!;
      facts.retryStarts.set(ep, (facts.retryStarts.get(ep) ?? 0) + 1);
    }
  }

  return facts;
}

/** 실행 하나를 판정한다 — 전멸률 집계의 기준. */
export function verdictOf(f: RunLogFacts): RunVerdict {
  if (!f.calledKra) return 'noCall';
  if (f.meetsAllFailed > 0) return 'allFail';
  // 출마표는 "전체 실패" 문구 대신 0건 + 에러로 나타난다 (2026-09-17 실측)
  if (f.cardResults.length > 0
    && f.cardResults.every((c) => c.races === 0)
    && f.cardResults.some((c) => c.errors > 0)) return 'allFail';
  if (f.comboFailedRaces > 0) return 'partial';
  return 'ok';
}

/**
 * 이 실행이 KRA를 몇 번 불렀는지 추정.
 *
 * 결과 API는 경마장당 1회(재시도는 `실패(시도 1/4)` 수만큼 더 샌다), 조합배당은
 * 응답 1,000건마다 1회다(`numOfRows=1000` 페이지네이션). 재시도 횟수는 1회차 실패만
 * 세므로 실제보다 적게 잡힐 수 있다 — **하한 추정**으로 쓴다.
 */
export function estimateKraCalls(f: RunLogFacts, meetsCalled: number): number {
  if (!f.calledKra) return 0;
  const comboCalls = f.comboReceived.reduce(
    (sum, n) => sum + Math.max(1, Math.ceil(n / COMBO_ROWS_PER_CALL)),
    0
  );
  const retries = [...f.retryStarts.values()].reduce((s, n) => s + n, 0);
  return meetsCalled + comboCalls + retries;
}

/**
 * 경주별 결과 도착 시각 — "누적 경주 수가 N으로 늘어난 첫 폴"이 N번째 경주가 들어온 때다.
 * `polls`는 시간순이어야 한다. 반환 Map: 경주 번호(1부터) → 그 폴의 시각.
 *
 * 실패한 폴은 누적값이 0으로 찍히므로 건너뛴다 — 안 그러면 진행이 뒤로 가는 것처럼 보인다.
 */
export function resultArrivalByRace(
  polls: Array<{ time: string; races: number; called: boolean }>
): Map<number, string> {
  const arrival = new Map<number, string>();
  let seen = 0;
  for (const p of polls) {
    if (!p.called || p.races <= seen) continue;
    for (let n = seen + 1; n <= p.races; n++) arrival.set(n, p.time);
    seen = p.races;
  }
  return arrival;
}

/** "HH:MM" → 자정 기준 분. 형식이 어긋나면 null. */
export function hhmmToMinutes(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
