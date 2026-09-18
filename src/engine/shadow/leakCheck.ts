/** 누수 점검: 수요일 보존 예측 vs 과거채우기 재계산 비교 (spec 2026-09-18 §5). */
export interface ScoreRow { hr_name: string; total_score: number; predicted_rank: number }
export type RaceCheckStatus = 'match' | 'field-changed' | 'mismatch';

export function compareRace(saved: ScoreRow[], recomputed: ScoreRow[], tol = 1e-6): { status: RaceCheckStatus; maxAbsDiff: number } {
  const a = new Map(saved.map((x) => [x.hr_name, x]));
  const b = new Map(recomputed.map((x) => [x.hr_name, x]));
  if (a.size !== b.size || [...a.keys()].some((k) => !b.has(k))) return { status: 'field-changed', maxAbsDiff: NaN };
  let maxAbsDiff = 0, rankDiff = false;
  for (const [k, x] of a) {
    const y = b.get(k)!;
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(Number(x.total_score) - Number(y.total_score)));
    if (x.predicted_rank !== y.predicted_rank) rankDiff = true;
  }
  return { status: maxAbsDiff > tol || rankDiff ? 'mismatch' : 'match', maxAbsDiff };
}

export function summarize(results: { status: RaceCheckStatus }[]) {
  const match = results.filter((r) => r.status === 'match').length;
  const fieldChanged = results.filter((r) => r.status === 'field-changed').length;
  const mismatch = results.filter((r) => r.status === 'mismatch').length;
  return { match, fieldChanged, mismatch, pass: mismatch === 0 && match > 0 };
}

/** 과거 채우기가 이 누수 점검 결과를 써도 되는지 판정 (spec §5 — 범위 명시 + 최신성). */
export interface LeakCheckFreshness { ok: boolean; reason?: string }

const LEAK_CHECK_MAX_AGE_MS = 7 * 24 * 3600_000;

export function isLeakCheckUsable(json: unknown, now: Date): LeakCheckFreshness {
  if (json == null || typeof json !== 'object') return { ok: false, reason: '기록 형식이 올바르지 않음' };
  const j = json as Record<string, unknown>;
  if (typeof j.pass !== 'boolean') return { ok: false, reason: '기록 형식이 올바르지 않음(pass 필드 없음)' };
  if (typeof j.checkedAt !== 'string') return { ok: false, reason: '기록 형식이 올바르지 않음(checkedAt 필드 없음)' };
  const checkedAt = new Date(j.checkedAt);
  if (Number.isNaN(checkedAt.getTime())) return { ok: false, reason: '기록 형식이 올바르지 않음(checkedAt 파싱 실패)' };
  if (j.pass !== true) return { ok: false, reason: '누수 점검 불합격' };
  const ageMs = now.getTime() - checkedAt.getTime();
  if (ageMs > LEAK_CHECK_MAX_AGE_MS || ageMs < 0) {
    return { ok: false, reason: `누수 점검이 오래됨(${j.checkedAt}) — 7일 이내 재실행 필요` };
  }
  return { ok: true };
}
