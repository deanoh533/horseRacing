import { describe, it, expect } from 'vitest';
import { TABLE_SPECS, ALL_TARGETS, isIncremental } from './tableSpecs.js';

describe('TABLE_SPECS', () => {
  it('증분 대상 6개', () => {
    const inc = Object.entries(TABLE_SPECS)
      .filter(([, s]) => s.mode === 'incremental')
      .map(([t]) => t)
      .sort();
    expect(inc).toEqual([
      'combo_dividends', 'gate_tests', 'predictions', 'race_entries',
      'shadow_predictions', 'training_logs',
    ]);
  });

  it('정렬 키는 PK의 날짜 키를 뺀 나머지', () => {
    expect(TABLE_SPECS['race_entries']).toEqual({
      mode: 'incremental', dateCol: 'race_date', orderCols: ['meet', 'rc_no', 'pthr_no'],
    });
    expect(TABLE_SPECS['training_logs']).toEqual({
      mode: 'incremental', dateCol: 'train_date', orderCols: ['meet', 'hr_no', 'part'],
    });
  });

  it('정렬 키에 날짜 컬럼이 다시 들어가면 안 된다', () => {
    for (const s of Object.values(TABLE_SPECS)) {
      if (s.mode === 'incremental') expect(s.orderCols).not.toContain(s.dateCol);
    }
  });

  it('ALL_TARGETS는 기존 12개 + 신규 3개 = 15개, 중복 없음', () => {
    expect(ALL_TARGETS).toHaveLength(15);
    expect(new Set(ALL_TARGETS).size).toBe(15);
    expect(ALL_TARGETS).toContain('combo_dividends');
    expect(ALL_TARGETS).toContain('shadow_predictions');
    expect(ALL_TARGETS).toContain('gate_tests');
  });

  it('ALL_TARGETS의 모든 이름이 TABLE_SPECS에 있다', () => {
    for (const t of ALL_TARGETS) expect(TABLE_SPECS[t]).toBeDefined();
  });

  it('isIncremental 타입 좁히기', () => {
    expect(isIncremental(TABLE_SPECS['races']!)).toBe(false);
    expect(isIncremental(TABLE_SPECS['predictions']!)).toBe(true);
  });
});
