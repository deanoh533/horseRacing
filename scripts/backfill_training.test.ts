import { describe, it, expect } from 'vitest';
import { enumerateDates, dedupTrainingRows, doneKey } from './backfill_training.js';

describe('doneKey', () => {
  it('date-meet 키 생성', () => {
    expect(doneKey(20260521, 1)).toBe('20260521-1');
    expect(doneKey(20260521, 3)).toBe('20260521-3');
  });
});

describe('enumerateDates', () => {
  it('월 경계 포함 일별 열거', () => {
    expect(enumerateDates(20240228, 20240302)).toEqual([20240228, 20240229, 20240301, 20240302]); // 2024 윤년
  });
});

describe('dedupTrainingRows', () => {
  it('PK(train_date,meet,hr_no,part) 중복 제거(후자 우선)', () => {
    const rows = [
      { train_date: 20240521, meet: 1, hr_no: 'A', part: 1, tr_term: 60 },
      { train_date: 20240521, meet: 1, hr_no: 'A', part: 1, tr_term: 99 },
      { train_date: 20240521, meet: 1, hr_no: 'B', part: 1, tr_term: 70 },
    ] as any[];
    const out = dedupTrainingRows(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.hr_no === 'A')!.tr_term).toBe(99);
  });
});
