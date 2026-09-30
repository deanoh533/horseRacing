import { describe, it, expect } from 'vitest';
import { stateCoef, toDryTime, fromDryTime, adjustShapeTimes } from './trackStateAdjust.js';

describe('stateCoef', () => {
  it('포화·불량만 계수, 나머지는 0', () => {
    expect(stateCoef('불량', 'early')).toBe(-0.0215);
    expect(stateCoef('불량', 'late')).toBe(-0.0178);
    expect(stateCoef('포화', 'early')).toBe(-0.0141);
    expect(stateCoef('포화', 'late')).toBe(-0.0093);
    for (const s of ['건조', '양호', '다습', '', '미지', null, undefined]) {
      expect(stateCoef(s, 'early')).toBe(0);
      expect(stateCoef(s, 'late')).toBe(0);
    }
  });
});

describe('toDryTime / fromDryTime', () => {
  it('젖은 주로가 빠르므로 건조 환산은 시간을 늘린다 (불량 초반 47초 → 47/0.9785)', () => {
    expect(toDryTime(47, '불량', 'early')).toBeCloseTo(47 / 0.9785, 8);
    expect(toDryTime(47, '불량', 'early')).toBeGreaterThan(47);
  });
  it('미등록 상태는 입력 그대로 (toBe)', () => {
    expect(toDryTime(47, '양호', 'early')).toBe(47);
    expect(toDryTime(47, null, 'late')).toBe(47);
  });
  it('환산 후 역환산하면 원래 값', () => {
    expect(fromDryTime(toDryTime(38.4, '포화', 'late'), '포화', 'late')).toBeCloseTo(38.4, 10);
  });
});

describe('adjustShapeTimes', () => {
  it('불량: g3f는 초반 계수, fin600(=rcTime−g3f)은 종반 계수로 환산, rcTime은 합', () => {
    const a = adjustShapeTimes(48, 86, '불량');
    expect(a.g3fAcc).toBeCloseTo(48 / 0.9785, 8);
    expect(a.rcTime - a.g3fAcc).toBeCloseTo(38 / 0.9822, 8);
  });
  it('건조·null·미지 상태는 입력 값 그대로 (부동소수 재계산 없음)', () => {
    for (const s of ['건조', null, undefined, '미지']) {
      const a = adjustShapeTimes(48.1, 86.3, s);
      expect(a.g3fAcc).toBe(48.1);
      expect(a.rcTime).toBe(86.3);
    }
  });
});
