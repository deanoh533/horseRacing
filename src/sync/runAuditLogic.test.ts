import { describe, it, expect } from 'vitest';
import {
  parseRunLog, verdictOf, estimateKraCalls, resultArrivalByRace, hhmmToMinutes,
} from './runAuditLogic.js';

/** 실제 `gh run view --log` 한 줄 형식: 잡\t스텝\t<ISO> 본문 */
const L = (body: string) =>
  `결과 폴러 (발주시각 기반)\tUNKNOWN STEP\t2026-09-20T09:15:37.3600692Z ${body}`;

// 2026-09-20 18:15 실행(11경주 전부 성공)에서 따온 형태
const OK_LOG = [
  L('🔔 20260920 — 확인할 경주 있음'),
  L('🔄 20260920 동기화 시작 (meets: 1,3)'),
  L('    [meet=1, rcNo=1] 조합배당 1020건 (수신 1040)'),
  L('    [meet=1, rcNo=2] 조합배당 4400건 (수신 4432)'),
  L('  meet=1: 11 경주 / 120 두 / 스킵 0 / 에러 0'),
  L('  meet=3: 0 경주 / 0 두 / 스킵 0 / 에러 0'),
].join('\n');

// 2026-09-20 16:00 실행(결과 API 전멸)
const ALL_FAIL_LOG = [
  L('🔔 20260920 — 확인할 경주 있음'),
  L('⚠️ KRA /API214_1/RaceDetailResult_1 실패(시도 1/4): timeout of 30000ms exceeded — 1000ms 후 재시도'),
  L('  [meet=1] ❌ 전체 실패: timeout of 30000ms exceeded'),
  L('  [meet=3] ❌ 전체 실패: timeout of 30000ms exceeded'),
  L('  meet=1: 0 경주 / 0 두 / 스킵 0 / 에러 1'),
  L('  meet=3: 0 경주 / 0 두 / 스킵 0 / 에러 1'),
].join('\n');

// 2026-09-18 16:00 실행(착순은 받고 조합배당만 실패)
const PARTIAL_LOG = [
  L('🔔 20260918 — 확인할 경주 있음'),
  L('⚠️ KRA /API160_1/integratedInfo_1 실패(시도 1/4): timeout of 30000ms exceeded — 1000ms 후 재시도'),
  L('    [meet=3, rcNo=3] 조합배당 수집 실패 (계속): timeout of 30000ms exceeded'),
  L('    [meet=3, rcNo=4] 조합배당 수집 실패 (계속): timeout of 30000ms exceeded'),
  L('  meet=3: 5 경주 / 55 두 / 스킵 4 / 에러 0'),
].join('\n');

// KRA를 안 부른 폴 — 그날 폴 133번 중 95번이 이랬다
const NO_CALL_LOG = [
  L('✅ 20260920 — 확인할 경주 없음'),
].join('\n');

describe('parseRunLog', () => {
  it('성공한 폴에서 경마장별 경주 수와 조합배당 응답 건수를 뽑는다', () => {
    const f = parseRunLog(OK_LOG);
    expect(f.calledKra).toBe(true);
    expect(f.racesByMeet.get(1)).toBe(11);
    expect(f.racesByMeet.get(3)).toBe(0);
    expect(f.comboReceived).toEqual([1040, 4432]);
    expect(f.meetsAllFailed).toBe(0);
  });

  it('전멸한 폴에서 경마장 수와 재시도를 센다', () => {
    const f = parseRunLog(ALL_FAIL_LOG);
    expect(f.meetsAllFailed).toBe(2);
    expect(f.retryStarts.get('/API214_1/RaceDetailResult_1')).toBe(1);
  });

  it('조합배당만 실패한 경주를 센다', () => {
    const f = parseRunLog(PARTIAL_LOG);
    expect(f.comboFailedRaces).toBe(2);
    expect(f.racesByMeet.get(3)).toBe(5);
  });

  it('KRA를 안 부른 폴은 calledKra=false', () => {
    expect(parseRunLog(NO_CALL_LOG).calledKra).toBe(false);
  });
});

describe('verdictOf', () => {
  it('부름 여부 → 전멸 → 조합배당 순으로 판정한다', () => {
    expect(verdictOf(parseRunLog(NO_CALL_LOG))).toBe('noCall');
    expect(verdictOf(parseRunLog(ALL_FAIL_LOG))).toBe('allFail');
    expect(verdictOf(parseRunLog(PARTIAL_LOG))).toBe('partial');
    expect(verdictOf(parseRunLog(OK_LOG))).toBe('ok');
  });
});

describe('estimateKraCalls', () => {
  it('결과 1회/경마장 + 조합배당 1,000건당 1회 + 재시도', () => {
    // 1040 → 2회, 4432 → 5회, 경마장 2곳, 재시도 0
    expect(estimateKraCalls(parseRunLog(OK_LOG), 2)).toBe(2 + 2 + 5);
  });

  it('KRA를 안 불렀으면 0', () => {
    expect(estimateKraCalls(parseRunLog(NO_CALL_LOG), 2)).toBe(0);
  });

  it('전멸한 폴도 재시도만큼은 호출했다', () => {
    expect(estimateKraCalls(parseRunLog(ALL_FAIL_LOG), 2)).toBe(2 + 0 + 1);
  });
});

describe('resultArrivalByRace', () => {
  const polls = [
    { time: '11:00', races: 1, called: true },
    { time: '11:15', races: 2, called: true },
    { time: '11:30', races: 2, called: true },  // 진전 없음
    { time: '11:45', races: 0, called: false }, // KRA 안 부름
    { time: '12:00', races: 5, called: true },  // 한 번에 3경주
  ];

  it('누적 경주 수가 늘어난 첫 폴을 도착 시각으로 본다', () => {
    const a = resultArrivalByRace(polls);
    expect(a.get(1)).toBe('11:00');
    expect(a.get(2)).toBe('11:15');
    expect(a.get(5)).toBe('12:00');
  });

  it('한 폴이 여러 경주를 한꺼번에 받으면 전부 그 시각', () => {
    const a = resultArrivalByRace(polls);
    expect(a.get(3)).toBe('12:00');
    expect(a.get(4)).toBe('12:00');
  });

  // 전멸한 폴은 누적값 0으로 찍힌다 — 그걸 반영하면 진행이 뒤로 간다
  it('실패한 폴(0건)이 섞여도 진행이 뒤로 가지 않는다', () => {
    const a = resultArrivalByRace([
      { time: '13:00', races: 3, called: true },
      { time: '13:15', races: 0, called: true },
      { time: '13:30', races: 4, called: true },
    ]);
    expect(a.get(3)).toBe('13:00');
    expect(a.get(4)).toBe('13:30');
  });
});

describe('hhmmToMinutes', () => {
  it('자정 기준 분으로 바꾼다', () => {
    expect(hhmmToMinutes('10:35')).toBe(635);
    expect(hhmmToMinutes('00:00')).toBe(0);
  });

  it('형식이 어긋나면 null', () => {
    expect(hhmmToMinutes('25:00')).toBeNull();
    expect(hhmmToMinutes('아무말')).toBeNull();
  });
});

// 2026-09-17(목) 출마표 잡 — KRA 타임아웃 전멸. 로그 형식이 폴러와 다르다.
const CARD_FAIL_LOG = [
  L('⚠️ KRA /API26_2/entrySheet_2 실패(시도 1/4): timeout of 30000ms exceeded — 1000ms 후 재시도'),
  L('  [meet=1] ❌ timeout of 30000ms exceeded'),
  L('  20260919 meet=1: 0 races / 0 horses / 1 errors'),
  L('  20260919 meet=3: 0 races / 0 horses / 1 errors'),
  L('❌ --fail-on-empty: 동기화 0건 + 에러 발생 (KRA 장애 — 데이터 구멍)'),
].join('\n');

const CARD_OK_LOG = [
  L('  20260920 meet=1: 11 races / 120 horses / 0 errors'),
  L('  20260920 meet=3: 0 races / 0 horses / 0 errors'),
].join('\n');

// 캐치업이 구멍을 못 찾으면 KRA를 아예 안 부른다 — 정상이라 실패로 세면 안 된다
const CATCHUP_CLEAN_LOG = L('✅ 캐치업 — 최근 7일 구멍 없음');

describe('출마표 잡 (폴러와 로그 형식이 다름)', () => {
  it('0건 + 에러면 전멸로 잡는다 (KRA 안 부름으로 새지 않게)', () => {
    const f = parseRunLog(CARD_FAIL_LOG);
    expect(f.calledKra).toBe(true);
    expect(f.cardResults).toEqual([{ races: 0, errors: 1 }, { races: 0, errors: 1 }]);
    expect(verdictOf(f)).toBe('allFail');
  });

  it('한 경마장이라도 받았으면 성공', () => {
    const f = parseRunLog(CARD_OK_LOG);
    expect(verdictOf(f)).toBe('ok');
  });

  it('캐치업이 구멍을 못 찾은 건 KRA 미호출 (실패 아님)', () => {
    expect(verdictOf(parseRunLog(CATCHUP_CLEAN_LOG))).toBe('noCall');
  });
});
