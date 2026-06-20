import { describe, it, expect } from 'vitest';
import { normalizeRow, buildUpsertSql, dedupByPk, TRAINING_COLS } from './upload_training_logs.js';
import type { TrainingLogRow } from '../src/sync/transformer.js';

const base: TrainingLogRow = {
  train_date: 20260101, meet: 1, hr_no: '0050860', hr_name: '테스트마',
  trar_nm: '조교사', part: 1, part_no: 3, chul_gubun: null,
  pr_gubun: '조', pr_no: '12', run1_cnt: 2, run2_cnt: 1,
  st_time: 20260101080000, sp_time: 20260101081000, tr_term: 600,
};

describe('normalizeRow', () => {
  it('part null → 1 (PK NOT NULL 보장)', () => {
    const vals = normalizeRow({ ...base, part: null });
    const idx = TRAINING_COLS.indexOf('part');
    expect(vals[idx]).toBe(1);
  });

  it('hr_no 7자리 zero-pad', () => {
    const vals = normalizeRow({ ...base, hr_no: '50860' });
    expect(vals[TRAINING_COLS.indexOf('hr_no')]).toBe('0050860');
  });

  it('컬럼 순서대로 값 배열 생성 (길이=컬럼수)', () => {
    const vals = normalizeRow(base);
    expect(vals.length).toBe(TRAINING_COLS.length);
    expect(vals[TRAINING_COLS.indexOf('tr_term')]).toBe(600);
  });

  it('undefined/누락 필드는 null', () => {
    const partial = { train_date: 20260101, meet: 1, hr_no: '0050860', hr_name: '말' } as TrainingLogRow;
    const vals = normalizeRow(partial);
    expect(vals[TRAINING_COLS.indexOf('trar_nm')]).toBeNull();
    expect(vals[TRAINING_COLS.indexOf('part')]).toBe(1);
  });
});

describe('buildUpsertSql', () => {
  it('N행 × M컬럼 placeholder 생성', () => {
    const sql = buildUpsertSql(2);
    const ncol = TRAINING_COLS.length;
    expect(sql).toContain(`$1`);
    expect(sql).toContain(`$${ncol}`);          // 1행 마지막
    expect(sql).toContain(`$${ncol + 1}`);      // 2행 시작
    expect(sql).toContain(`$${ncol * 2}`);      // 2행 마지막
    expect(sql).not.toContain(`$${ncol * 2 + 1}`);
  });

  it('PK 충돌 시 DO UPDATE (PK 컬럼 제외)', () => {
    const sql = buildUpsertSql(1);
    expect(sql).toContain('ON CONFLICT (train_date,meet,hr_no,part) DO UPDATE');
    expect(sql).toContain('hr_name=EXCLUDED.hr_name');
    expect(sql).not.toContain('train_date=EXCLUDED.train_date'); // PK는 갱신 X
  });
});

describe('dedupByPk', () => {
  it('coalesce 후 같은 PK는 마지막 행만 (배치 내 중복 제거)', () => {
    const rows: TrainingLogRow[] = [
      { ...base, part: null, hr_name: '먼저' }, // → part 1
      { ...base, part: 1, hr_name: '나중' },     // part 1, 같은 PK
    ];
    const out = dedupByPk(rows);
    expect(out.length).toBe(1);
    expect(out[0]!.hr_name).toBe('나중');
  });

  it('다른 PK는 보존', () => {
    const rows: TrainingLogRow[] = [
      { ...base, part: 1 },
      { ...base, part: 2 },
    ];
    expect(dedupByPk(rows).length).toBe(2);
  });
});
