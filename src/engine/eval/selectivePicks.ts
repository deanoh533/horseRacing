// src/engine/eval/selectivePicks.ts
/**
 * 선별 표시(Selective Picks) 순수 로직 — p_top3 보정확률 → 강추/주목 티어,
 * 임계값별 적중률·커버리지 곡선, 티어별 실측, 목표적중률→임계값 역산.
 * I/O 없음(테스트 용이). 임계값은 호출측이 주입(config JSON은 probe/클라이언트가 읽음).
 * 설계: docs/superpowers/specs/2026-06-25-selective-picks-design.md
 */
export type PickTier = 'strong' | 'watch' | null;

export interface PredRow {
  race_date: number; meet: number; rc_no: number;
  p_top3: number | null; p_win: number | null; actual_ord: number | null;
}

/** p_top3 → 티어. minProb<=0 인 티어는 비활성. 강추 우선, 그다음 주목. */
export function classifyTier(pTop3: number | null, strongMin: number, watchMin: number): PickTier {
  if (pTop3 == null) return null;
  if (strongMin > 0 && pTop3 >= strongMin) return 'strong';
  if (watchMin > 0 && pTop3 >= watchMin) return 'watch';
  return null;
}

const raceKey = (r: PredRow): string => `${r.race_date}-${r.meet}-${r.rc_no}`;
const isPlace = (r: PredRow): boolean => r.actual_ord != null && r.actual_ord >= 1 && r.actual_ord <= 3;
const isWin = (r: PredRow): boolean => r.actual_ord === 1;
const onlyResolved = (rows: PredRow[]): PredRow[] => rows.filter((r) => r.actual_ord != null && r.p_top3 != null);

export interface CurvePoint {
  threshold: number; picks: number;
  placeHitRate: number; winHitRate: number; coverage: number;
}
export interface CurveResult {
  totalRows: number; totalRaces: number;
  baselinePlace: number; baselineWin: number;
  points: CurvePoint[];
}

/** 사후 행(actual_ord·p_top3 둘 다 non-null) 대상. */
export function buildSelectionCurve(rows: PredRow[], thresholds: number[]): CurveResult {
  const valid = onlyResolved(rows);
  const allRaces = new Set(valid.map(raceKey));
  const rate = (sel: PredRow[], pred: (r: PredRow) => boolean): number =>
    sel.length ? sel.filter(pred).length / sel.length : 0;
  const points = thresholds.map((t): CurvePoint => {
    const picks = valid.filter((r) => (r.p_top3 as number) >= t);
    return {
      threshold: t,
      picks: picks.length,
      placeHitRate: rate(picks, isPlace),
      winHitRate: rate(picks, isWin),
      coverage: allRaces.size ? new Set(picks.map(raceKey)).size / allRaces.size : 0,
    };
  });
  return {
    totalRows: valid.length, totalRaces: allRaces.size,
    baselinePlace: rate(valid, isPlace), baselineWin: rate(valid, isWin),
    points,
  };
}

export interface TierStat {
  tier: 'strong' | 'watch';
  picks: number; placeHitRate: number; winHitRate: number; coverage: number;
}

/** 확정 임계값으로 티어별 실측. watch = [watchMin, strongMin) 배타. */
export function tierAccuracy(rows: PredRow[], strongMin: number, watchMin: number): TierStat[] {
  const valid = onlyResolved(rows);
  const allRaces = new Set(valid.map(raceKey));
  const rate = (sel: PredRow[], pred: (r: PredRow) => boolean): number =>
    sel.length ? sel.filter(pred).length / sel.length : 0;
  const stat = (sel: PredRow[], tier: 'strong' | 'watch'): TierStat => ({
    tier, picks: sel.length,
    placeHitRate: rate(sel, isPlace), winHitRate: rate(sel, isWin),
    coverage: allRaces.size ? new Set(sel.map(raceKey)).size / allRaces.size : 0,
  });
  const isStrong = (r: PredRow): boolean => strongMin > 0 && (r.p_top3 as number) >= strongMin;
  const strong = valid.filter(isStrong);
  const watch = valid.filter((r) => watchMin > 0 && (r.p_top3 as number) >= watchMin && !isStrong(r));
  return [stat(strong, 'strong'), stat(watch, 'watch')];
}

/** placeHitRate ≥ target 를 만족하는 가장 낮은 threshold(커버리지 최대). 없으면 null. */
export function pickThreshold(curve: CurveResult, targetPlace: number): number | null {
  const sorted = [...curve.points].sort((a, b) => a.threshold - b.threshold);
  for (const p of sorted) if (p.placeHitRate >= targetPlace) return p.threshold;
  return null;
}
