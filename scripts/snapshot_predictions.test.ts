import { describe, it, expect } from 'vitest';
import { snapshotTableName, tablesToPrune } from './snapshot_predictions.js';

describe('snapshotTableName', () => {
  it('predictions_snapshot_YYYYMMDD 형식', () => {
    expect(snapshotTableName(new Date(2026, 6, 12))).toBe('predictions_snapshot_20260712');
  });
});

describe('tablesToPrune', () => {
  const names = [
    'predictions_snapshot_20260701',
    'predictions_snapshot_20260712',
    'predictions_snapshot_20260615',
  ];

  it('최신 keep개를 남기고 오래된 것을 반환', () => {
    expect(tablesToPrune(names, 2)).toEqual(['predictions_snapshot_20260615']);
  });

  it('keep이 전체 이상이면 빈 배열', () => {
    expect(tablesToPrune(names, 5)).toEqual([]);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const copy = [...names];
    tablesToPrune(names, 1);
    expect(names).toEqual(copy);
  });
});
