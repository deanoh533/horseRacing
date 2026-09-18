import { describe, it, expect } from 'vitest';
import { compareRace, summarize, isLeakCheckUsable } from './leakCheck.js';

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

describe('isLeakCheckUsable', () => {
  const now = new Date('2026-09-18T00:00:00.000Z');

  it('최근(7일 이내) 합격 기록은 사용 가능', () => {
    const fresh = { pass: true, checkedAt: '2026-09-15T00:00:00.000Z', from: 20260711, to: 20260917 };
    expect(isLeakCheckUsable(fresh, now)).toEqual({ ok: true });
  });

  it('7일 넘은 합격 기록은 거부', () => {
    const stale = { pass: true, checkedAt: '2026-09-01T00:00:00.000Z', from: 20260711, to: 20260901 };
    const r = isLeakCheckUsable(stale, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/오래됨/);
  });

  it('불합격 기록은 최신이어도 거부', () => {
    const failed = { pass: false, checkedAt: '2026-09-17T00:00:00.000Z', from: 20260711, to: 20260917 };
    const r = isLeakCheckUsable(failed, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/불합격/);
  });

  it('형식이 잘못된(malformed) 기록은 거부', () => {
    expect(isLeakCheckUsable(null, now).ok).toBe(false);
    expect(isLeakCheckUsable({}, now).ok).toBe(false);
    expect(isLeakCheckUsable({ pass: true }, now).ok).toBe(false); // checkedAt 없음
    expect(isLeakCheckUsable({ pass: true, checkedAt: 'not-a-date' }, now).ok).toBe(false);
    expect(isLeakCheckUsable('pass', now).ok).toBe(false);
  });
});
