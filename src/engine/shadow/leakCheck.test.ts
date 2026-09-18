import { describe, it, expect } from 'vitest';
import { compareRace, summarize } from './leakCheck.js';

const r = (hr: string, s: number, k: number) => ({ hr_name: hr, total_score: s, predicted_rank: k });

describe('compareRace', () => {
  it('점수·순위 동일 → match', () => {
    expect(compareRace([r('A', 1, 1), r('B', 0.5, 2)], [r('B', 0.5, 2), r('A', 1, 1)]).status).toBe('match');
  });
  it('출전마 집합이 다르면 field-changed (출전 취소 등 정상 차이)', () => {
    expect(compareRace([r('A', 1, 1), r('B', 0.5, 2)], [r('A', 1, 1)]).status).toBe('field-changed');
  });
  it('허용오차 초과 점수 차 → mismatch, 최대차 보고', () => {
    const res = compareRace([r('A', 1, 1), r('B', 0.5, 2)], [r('A', 1.01, 1), r('B', 0.5, 2)]);
    expect(res.status).toBe('mismatch');
    expect(res.maxAbsDiff).toBeCloseTo(0.01);
  });
  it('점수는 거의 같아도 순위가 다르면 mismatch', () => {
    expect(compareRace([r('A', 1, 1), r('B', 1, 2)], [r('A', 1, 2), r('B', 1, 1)]).status).toBe('mismatch');
  });
});

describe('summarize', () => {
  it('mismatch 0 이고 match ≥ 1 이면 pass', () => {
    expect(summarize([{ status: 'match' }, { status: 'field-changed' }]).pass).toBe(true);
    expect(summarize([{ status: 'match' }, { status: 'mismatch' }]).pass).toBe(false);
    expect(summarize([{ status: 'field-changed' }]).pass).toBe(false);
  });
});
