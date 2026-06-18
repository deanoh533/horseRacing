import { describe, it, expect } from 'vitest';
import { toTrainingRow } from './transformer.js';

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
