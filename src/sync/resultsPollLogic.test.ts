import { describe, it, expect } from 'vitest';
import { parseStTime, hasDueUnsyncedRace } from './resultsPollLogic.js';

describe('parseStTime', () => {
  it('"출발 :10:35" → 10:35 = 635분', () => {
    expect(parseStTime('출발 :10:35')).toBe(635);
  });

  it('한 자리 시(예: "출발 :9:05")도 파싱한다', () => {
    expect(parseStTime('출발 :9:05')).toBe(545);
  });

  it('null·undefined는 null', () => {
    expect(parseStTime(null)).toBeNull();
    expect(parseStTime(undefined)).toBeNull();
  });

  it('빈 문자열·형식 불일치는 null', () => {
    expect(parseStTime('')).toBeNull();
    expect(parseStTime('취소')).toBeNull();
  });

  it('범위를 벗어난 시·분은 null', () => {
    expect(parseStTime('출발 :25:00')).toBeNull();
    expect(parseStTime('출발 :10:75')).toBeNull();
  });
});

describe('hasDueUnsyncedRace', () => {
  const BUFFER = 15;

  it('발주시각+여유가 지났고 결과 없으면 true', () => {
    // 10:35 출발 + 15분 = 10:50. 지금 10:50 → 정확히 경계에서 true
    expect(hasDueUnsyncedRace(
      [{ stTime: '출발 :10:35', hasResult: false, hasCombo: false }], 650, BUFFER
    )).toBe(true);
  });

  it('여유시간이 아직 안 지났으면 false', () => {
    // 10:35 출발 + 15분 = 10:50. 지금 10:49
    expect(hasDueUnsyncedRace(
      [{ stTime: '출발 :10:35', hasResult: false, hasCombo: false }], 649, BUFFER
    )).toBe(false);
  });

  it('이미 결과가 있으면 시간이 지났어도 false', () => {
    expect(hasDueUnsyncedRace(
      [{ stTime: '출발 :10:35', hasResult: true, hasCombo: true }], 900, BUFFER
    )).toBe(false);
  });

  it('발주시각을 못 읽는 경주는 판단 대상에서 제외한다', () => {
    expect(hasDueUnsyncedRace(
      [{ stTime: null, hasResult: false, hasCombo: false }], 900, BUFFER
    )).toBe(false);
  });

  it('여러 경주 중 하나라도 해당하면 true', () => {
    expect(hasDueUnsyncedRace(
      [
        { stTime: '출발 :10:35', hasResult: true, hasCombo: true },
        { stTime: '출발 :19:55', hasResult: false, hasCombo: false }, // 아직 안 지남
        { stTime: '출발 :14:00', hasResult: false, hasCombo: false }, // 지남
      ],
      900, // 15:00
      BUFFER
    )).toBe(true);
  });

  it('경주 목록이 비어 있으면 false (휴장일 등)', () => {
    expect(hasDueUnsyncedRace([], 900, BUFFER)).toBe(false);
  });
});

describe('hasDueUnsyncedRace — 조합배당만 빠진 경주', () => {
  const BUFFER = 15;

  // 2026-09-18: 그날 마지막 결과를 받은 폴러에서 조합배당만 실패하면, 착순은 있으니
  // 폴러가 더는 KRA를 안 불러 조합배당이 영구로 빠질 수 있었다.
  it('착순은 있는데 조합배당이 없으면 true (다시 받아야 함)', () => {
    expect(hasDueUnsyncedRace(
      [{ stTime: '출발 :19:55', hasResult: true, hasCombo: false }], 1230, BUFFER
    )).toBe(true);
  });

  it('착순·조합배당 둘 다 있으면 false', () => {
    expect(hasDueUnsyncedRace(
      [{ stTime: '출발 :19:55', hasResult: true, hasCombo: true }], 1230, BUFFER
    )).toBe(false);
  });

  it('조합배당이 없어도 발주+여유 전이면 false (아직 안 끝난 경주)', () => {
    expect(hasDueUnsyncedRace(
      [{ stTime: '출발 :19:55', hasResult: true, hasCombo: false }], 1200, BUFFER
    )).toBe(false);
  });
});
