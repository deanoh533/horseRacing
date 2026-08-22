import { describe, it, expect } from 'vitest';
import { toTrainingRow, toRaceRow, toRaceRowFromEntrySheet } from './transformer.js';

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
