import { describe, it, expect } from 'vitest';
import { decideSyncPlan, FULL_RELOAD_RATIO, type SyncPlanInput } from './syncPlan.js';
import type { FingerprintDiff } from './fingerprint.js';

const diff = (changed: number[] = [], removed: number[] = [], unchanged: number[] = []): FingerprintDiff =>
  ({ changed, removed, unchanged });

const base: SyncPlanInput = {
  forced: false, directConnection: true, tableExistsInMirror: true,
  hasStoredFingerprints: true, sourceDateCount: 100, diff: diff(),
};

describe('decideSyncPlan — 전량 전환 5규칙', () => {
  it('미러에 테이블 없음 → 전량', () => {
    expect(decideSyncPlan({ ...base, tableExistsInMirror: false }))
      .toEqual({ kind: 'full', reason: 'no-table' });
  });

  it('저장된 지문 없음 → 전량', () => {
    expect(decideSyncPlan({ ...base, hasStoredFingerprints: false }))
      .toEqual({ kind: 'full', reason: 'no-fingerprints' });
  });

  it('바뀜+사라짐이 절반 초과 → 전량', () => {
    const changed = Array.from({ length: 51 }, (_, i) => i);
    expect(decideSyncPlan({ ...base, sourceDateCount: 100, diff: diff(changed) }))
      .toEqual({ kind: 'full', reason: 'too-many-changed' });
  });

  it('정확히 절반이면 증분 (초과여야 전량)', () => {
    const changed = Array.from({ length: 50 }, (_, i) => i);
    expect(decideSyncPlan({ ...base, sourceDateCount: 100, diff: diff(changed) }).kind)
      .toBe('incremental');
  });

  it('사라짐도 절반 계산에 포함', () => {
    const changed = Array.from({ length: 30 }, (_, i) => i);
    const removed = Array.from({ length: 21 }, (_, i) => 1000 + i);
    expect(decideSyncPlan({ ...base, sourceDateCount: 100, diff: diff(changed, removed) }))
      .toEqual({ kind: 'full', reason: 'too-many-changed' });
  });

  it('--full → 전량', () => {
    expect(decideSyncPlan({ ...base, forced: true }))
      .toEqual({ kind: 'full', reason: 'forced' });
  });

  it('REST 폴백(직결 없음) → 전량', () => {
    expect(decideSyncPlan({ ...base, directConnection: false }))
      .toEqual({ kind: 'full', reason: 'no-direct-connection' });
  });

  it('우선순위: --full이 다른 사유보다 앞선다', () => {
    expect(decideSyncPlan({ ...base, forced: true, tableExistsInMirror: false }))
      .toEqual({ kind: 'full', reason: 'forced' });
  });
});

describe('decideSyncPlan — 증분·건너뜀', () => {
  it('바뀐 게 없으면 건너뜀', () => {
    expect(decideSyncPlan({ ...base, diff: diff([], [], [20260101]) })).toEqual({ kind: 'skip' });
  });

  it('바뀐 날짜만 싣는다', () => {
    expect(decideSyncPlan({ ...base, diff: diff([20260102], [20260104]) }))
      .toEqual({ kind: 'incremental', load: [20260102], remove: [20260104] });
  });

  it('사라짐만 있어도 증분(삭제만 수행)', () => {
    expect(decideSyncPlan({ ...base, diff: diff([], [20260104]) }))
      .toEqual({ kind: 'incremental', load: [], remove: [20260104] });
  });

  // Review Focus 1 — 빈 테이블
  it('원천 날짜가 0개여도 0으로 나누지 않는다 — 바뀐 것 없으면 건너뜀', () => {
    expect(decideSyncPlan({ ...base, sourceDateCount: 0, diff: diff() })).toEqual({ kind: 'skip' });
  });

  // Review Focus 2 — 원천이 통째로 비었을 때
  it('원천이 통째로 비었는데 저장 지문이 있으면 전량(미러도 비운다)', () => {
    expect(decideSyncPlan({ ...base, sourceDateCount: 0, diff: diff([], [20260101, 20260102]) }))
      .toEqual({ kind: 'full', reason: 'too-many-changed' });
  });

  it('FULL_RELOAD_RATIO는 0.5', () => {
    expect(FULL_RELOAD_RATIO).toBe(0.5);
  });
});
