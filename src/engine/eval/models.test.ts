import { describe, it, expect } from 'vitest';
import { selectSchema } from './models.js';

// 02_weight_change 안에 '지난 경주들의 마체중 변화'(라이브 가용)와
// '오늘 마체중'(라이브 미가용)이 함께 있다 → 항목 단위로는 분리 불가.
const FULL = [
  'weight_diff_last',
  'weight_diff_slope',
  'body_weight',
  'body_weight_minus_field_mean',
  'recent_ord_last',
  'recent_ord_last__missing',
];
const APPROVED = new Set(['02_weight_change', '03_recent_form']);

describe('selectSchema', () => {
  it('승인 항목만 남기고 __missing은 뺀다', () => {
    expect(selectSchema(FULL, APPROVED)).toEqual([
      'weight_diff_last', 'weight_diff_slope', 'body_weight',
      'body_weight_minus_field_mean', 'recent_ord_last',
    ]);
  });

  it('피처 이름으로 하나씩 뺄 수 있다 — 같은 항목의 나머지는 남는다', () => {
    const got = selectSchema(FULL, APPROVED, new Set(['body_weight', 'body_weight_minus_field_mean']));
    expect(got).toEqual(['weight_diff_last', 'weight_diff_slope', 'recent_ord_last']);
  });

  it('승인되지 않은 항목은 제외 목록과 무관하게 빠진다', () => {
    expect(selectSchema(FULL, new Set(['03_recent_form']))).toEqual(['recent_ord_last']);
  });
});
