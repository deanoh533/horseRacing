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
