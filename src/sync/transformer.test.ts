import { describe, it, expect } from 'vitest';
import {
  toTrainingRow, toRaceRow, toRaceRowFromEntrySheet, toRaceEntryResultRow,
  toRaceEntryRowFromEntrySheet,
} from './transformer.js';

// KRATrainingRecord 픽스처 (hrNo만 가변 — KRA가 문자열/숫자 혼재 반환)
const rec = (hrNo: unknown) =>
  ({
    trDate: 20260520, meet: '서울', hrNo, hrName: 'x', trName: 't',
    part: 1, partNo: 1, chulGubun: '-', prGubun: '-', prNo: '-',
    run1Cnt: 0, run2Cnt: 0, stTime: 0, spTime: 0, trTerm: 0,
  }) as any;

describe('toTrainingRow hr_no 정규화 (회귀: JSON 타입 추론 방지 + 선행0 복원)', () => {
  it('문자열 마번은 7자리 그대로', () => {
    expect(toTrainingRow(rec('0050860')).hr_no).toBe('0050860');
  });
  it('숫자 마번(선행0 탈락)은 7자리 zero-pad 복원', () => {
    expect(toTrainingRow(rec(50860)).hr_no).toBe('0050860');
  });
  it('항상 string 타입 (read_json_auto VARCHAR 추론 보장)', () => {
    expect(typeof toTrainingRow(rec(50860)).hr_no).toBe('string');
  });
});

// ============================================
// toRaceRow — 출마표가 채운 컬럼을 결과 sync가 지우지 않아야 한다
// ============================================

// KRARaceResult 픽스처 (결과 API는 발주시각·4·5착 상금을 주지 않는다)
const resultHorse = () =>
  ({
    rcDate: 20260823, meet: '서울', rcNo: 3, rcDist: 1400,
    rcName: '일반', rcDay: '일요일', track: '건조 (2%)', weather: '맑음',
    ageCond: '연령오픈', prizeCond: '오픈', chaksun1: 1000, chaksun2: 500, chaksun3: 300,
  }) as any;

describe('toRaceRow 컬럼 보존 (회귀: 결과 sync가 출마표 값을 NULL로 덮어씀)', () => {
  it('결과 API가 모르는 컬럼은 행에 아예 넣지 않는다 (upsert SET 절 제외 → 기존 값 보존)', () => {
    const row = toRaceRow(resultHorse());
    // 키 자체가 없어야 한다. `st_time: null`이면 upsert가 NULL로 덮어쓴다.
    expect('st_time' in row).toBe(false);
    expect('chaksun4' in row).toBe(false);
    expect('chaksun5' in row).toBe(false);
  });

  it('결과 API가 주는 컬럼은 그대로 채운다', () => {
    const row = toRaceRow(resultHorse());
    expect(row.race_date).toBe(20260823);
    expect(row.meet).toBe(1);
    expect(row.rc_no).toBe(3);
    expect(row.track).toBe('건조 (2%)');
    expect(row.track_type).toBe('건조');
    expect(row.weather).toBe('맑음');
    expect(row.chaksun1).toBe(1000);
    expect(row.chaksun3).toBe(300);
  });
});

describe('toRaceRowFromEntrySheet 발주시각', () => {
  const entry = () =>
    ({
      rcDate: 20260823, meet: '서울', rcNo: 1, rcDist: 1000,
      rcName: '일반', rcDay: '일요일', ageCond: '연령오픈', prizeCond: '오픈',
      stTime: '출발 :10:35', chaksun1: 1000, chaksun2: 500,
      chaksun3: 300, chaksun4: 200, chaksun5: 100,
    }) as any;

  it('출마표는 발주시각·4·5착 상금을 채운다 (보존 대상)', () => {
    const row = toRaceRowFromEntrySheet(entry());
    expect(row.st_time).toBe('출발 :10:35');
    expect(row.chaksun4).toBe(200);
    expect(row.chaksun5).toBe(100);
  });
});

// ============================================
// fetched_at — 출마표 신선도
// 회귀: DB 기본값(DEFAULT NOW(), migration 004)에만 맡기면 INSERT에만 찍혀
// "최초 수집 시각"이 된다. 2026-09-17 출마표 잡이 전멸했는데도 9/18~20 행은
// 전부 9/16 값 그대로였고(재실행은 UPDATE라 기본값이 안 먹음), 설정탭은 그 값을
// "마지막 수집 시각"으로 보여주고 있었다. 매퍼가 매번 채워야 신선도가 보인다.
// ============================================
describe('toRaceEntryRowFromEntrySheet fetched_at (회귀: 재실행이 수집 시각을 안 남김)', () => {
  const item = () =>
    ({
      rcDate: 20260919, meet: '서울', rcNo: 1, chulNo: 3, hrName: '천하무적',
      hrNo: '0050860', jkNo: '080476', trNo: '070090', age: 4, sex: '수',
      wgBudam: 55, rating: 0,
    }) as any;

  it('출마표 행에 수집 시각을 남긴다', () => {
    const before = Date.now();
    const row = toRaceEntryRowFromEntrySheet(item());
    const t = Date.parse(row.fetched_at);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('재실행마다 갱신된다 (UPDATE 경로에서도 값이 실려야 함)', async () => {
    const first = toRaceEntryRowFromEntrySheet(item()).fetched_at;
    await new Promise((r) => setTimeout(r, 2));
    const second = toRaceEntryRowFromEntrySheet(item()).fetched_at;
    expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
  });
});

// ============================================
// toRaceEntryResultRow.ord — 미시행 경주(ord=0) 가드
// 회귀: 2026-08-15·08-22 서울 R9·R10(야간 막판 경주)이 19시 결과 sync 시점에
// 아직 시행 전이라 KRA가 ord=0으로 내려줬는데, 하한 가드가 없어 그대로 저장됨.
// → UI에 "0위" 표시 + `actual_ord <= 3` 적중률 필터에 0이 걸려 통계 오염.
// ============================================
const entryHorse = (ord: unknown) =>
  ({
    rcDate: 20260822, meet: '서울', rcNo: 9, hrName: '스톰가이',
    hrNo: '0050860', jkNo: '080476', trNo: '070090',
    ord, rcTime: 0, diffUnit: '-', wgHr: '480(+2)', wgJk: 55,
    winOdds: 4.3, plcOdds: 1.8, rating: 0,
  }) as any;

describe('toRaceEntryResultRow ord 가드 (회귀: 미시행 경주 0위 저장)', () => {
  it('ord=0(미시행·미확정)은 null — 저장하면 "0위" 표시 + 적중률 오염', () => {
    expect(toRaceEntryResultRow(entryHorse(0)).ord).toBeNull();
  });
  it('ord=90+(실격·기권 코드)는 기존대로 null', () => {
    expect(toRaceEntryResultRow(entryHorse(99)).ord).toBeNull();
  });
  it('ord=null은 null', () => {
    expect(toRaceEntryResultRow(entryHorse(null)).ord).toBeNull();
  });
  it('정상 착순 1은 보존 (경계값 — 하한 가드가 1을 잡아먹으면 안 됨)', () => {
    expect(toRaceEntryResultRow(entryHorse(1)).ord).toBe(1);
  });
  it('정상 착순 12는 보존', () => {
    expect(toRaceEntryResultRow(entryHorse(12)).ord).toBe(12);
  });
});
