/** 지문 비교 결과 → "이 테이블을 어떻게 받을까" 결정. spec §5.6. */
import type { FingerprintDiff } from './fingerprint.js';

/** 바뀐 날짜 비율이 이 값을 **초과**하면 날짜별로 지우고 넣기보다 통째가 빠르다. */
export const FULL_RELOAD_RATIO = 0.5;

export type FullReason =
  | 'forced'                // --full
  | 'no-direct-connection'  // REST 폴백 — 지문 SQL을 못 돌린다
  | 'no-table'              // 미러에 테이블 없음(첫 실행)
  | 'no-fingerprints'       // _sync_state에 이 테이블 지문이 없음
  | 'too-many-changed';     // 절반 초과

export type SyncPlan =
  | { kind: 'skip' }
  | { kind: 'incremental'; load: number[]; remove: number[] }
  | { kind: 'full'; reason: FullReason };

export interface SyncPlanInput {
  forced: boolean;
  directConnection: boolean;
  tableExistsInMirror: boolean;
  hasStoredFingerprints: boolean;
  sourceDateCount: number;
  diff: FingerprintDiff;
}

/** 사람이 읽을 전량 사유 (로그용) */
export const FULL_REASON_LABEL: Record<FullReason, string> = {
  forced: '--full 지정',
  'no-direct-connection': 'REST 폴백 — 지문 불가',
  'no-table': '미러에 테이블 없음',
  'no-fingerprints': '지문 없음(첫 증분)',
  'too-many-changed': '바뀐 날짜가 절반 초과',
};

export function decideSyncPlan(input: SyncPlanInput): SyncPlan {
  if (input.forced) return { kind: 'full', reason: 'forced' };
  if (!input.directConnection) return { kind: 'full', reason: 'no-direct-connection' };
  if (!input.tableExistsInMirror) return { kind: 'full', reason: 'no-table' };
  if (!input.hasStoredFingerprints) return { kind: 'full', reason: 'no-fingerprints' };

  const { changed, removed } = input.diff;
  const touched = changed.length + removed.length;
  if (touched === 0) return { kind: 'skip' };

  // 원천 날짜가 0인데 손댈 게 있다 = 원천이 통째로 비었다 → 전량으로 미러를 비운다.
  // (0으로 나누지 않는다)
  if (input.sourceDateCount === 0) return { kind: 'full', reason: 'too-many-changed' };
  if (touched > input.sourceDateCount * FULL_RELOAD_RATIO) {
    return { kind: 'full', reason: 'too-many-changed' };
  }

  return { kind: 'incremental', load: changed, remove: removed };
}
