/**
 * /lab 섀도 비교 지표 (spec 2026-09-18 §6.1). 이름이 아니라 규칙으로 정의:
 *  단승 = 1순위가 1착 / 연승 = 1순위가 3착 안 / 복승 = 1·2순위 두 마리 모두 2착 안(순서무관)
 *  TOP3 겹침 = 예측 상위3 중 실제 3착 안 마릿수. actual_ord null(취소 등) = 적중 아님.
 */
export interface LabRow {
  race_date: number; meet: number; rc_no: number; hr_name: string;
  predicted_rank: number; actual_ord: number | null; model_version: number;
  source?: 'live' | 'backfill' | 'prod';
}
export const raceKey = (r: { race_date: number; meet: number; rc_no: number }) => `${r.race_date}-${r.meet}-${r.rc_no}`;

const inTop = (o: number | null, k: number) => o != null && o >= 1 && o <= k;

export function raceHits(rows: LabRow[]) {
  if (!rows.some((r) => r.actual_ord != null)) return null;
  const by = [...rows].sort((a, b) => a.predicted_rank - b.predicted_rank);
  const p1 = by[0], p2 = by[1];
  return {
    win: !!p1 && p1.actual_ord === 1,
    place: !!p1 && inTop(p1.actual_ord, 3),
    quinella: !!p1 && !!p2 && inTop(p1.actual_ord, 2) && inTop(p2.actual_ord, 2),
    top3Overlap: by.slice(0, 3).filter((r) => inTop(r.actual_ord, 3)).length,
  };
}

/** 대응 비교(같은 경주) 95% 흔들림 폭. b=라이브만 적중, c=섀도만 적중. */
export function pairedNoise(liveHits: boolean[], shadowHits: boolean[]) {
  const n = liveHits.length;
  if (n === 0) return { delta: 0, band: 0 };
  let b = 0, c = 0;
  for (let i = 0; i < n; i++) { if (liveHits[i] && !shadowHits[i]) b++; if (!liveHits[i] && shadowHits[i]) c++; }
  const delta = (c - b) / n;
  const variance = Math.max(0, b + c - (c - b) ** 2 / n) / (n * n);
  return { delta, band: 1.96 * Math.sqrt(variance) };
}

function groupBy(rows: LabRow[]) {
  const m = new Map<string, Map<number, LabRow[]>>();
  for (const r of rows) {
    const k = raceKey(r);
    if (!m.has(k)) m.set(k, new Map());
    const byV = m.get(k)!;
    if (!byV.has(r.model_version)) byV.set(r.model_version, []);
    byV.get(r.model_version)!.push(r);
  }
  return m;
}

export interface ScoreboardRow {
  version: number; races: number; win: number; place: number; quinella: number; top3Overlap: number;
  placeDelta: number | null; placeBand: number | null;
}

function agg(version: number, hits: NonNullable<ReturnType<typeof raceHits>>[]): ScoreboardRow {
  const n = hits.length || 1;
  return {
    version, races: hits.length,
    win: hits.filter((h) => h.win).length / n,
    place: hits.filter((h) => h.place).length / n,
    quinella: hits.filter((h) => h.quinella).length / n,
    top3Overlap: hits.reduce((s, h) => s + h.top3Overlap, 0) / n,
    placeDelta: null, placeBand: null,
  };
}

export function buildScoreboard(live: LabRow[], shadow: LabRow[], liveVersion: number): ScoreboardRow[] {
  const liveG = groupBy(live), shG = groupBy(shadow);
  const liveHits = new Map<string, NonNullable<ReturnType<typeof raceHits>>>();
  for (const [k, byV] of liveG) { const h = raceHits(byV.get(liveVersion) ?? []); if (h) liveHits.set(k, h); }
  const out: ScoreboardRow[] = [agg(liveVersion, [...liveHits.values()])];

  const versions = [...new Set(shadow.map((r) => r.model_version))].sort((a, b) => a - b);
  for (const v of versions) {
    const common: { l: NonNullable<ReturnType<typeof raceHits>>; s: NonNullable<ReturnType<typeof raceHits>> }[] = [];
    for (const [k, byV] of shG) {
      const l = liveHits.get(k); const s = raceHits(byV.get(v) ?? []);
      if (l && s) common.push({ l, s });
    }
    const row = agg(v, common.map((c) => c.s));
    const noise = pairedNoise(common.map((c) => c.l.place), common.map((c) => c.s.place));
    row.placeDelta = noise.delta; row.placeBand = noise.band;
    out.push(row);
  }
  return out;
}

export interface RaceComparison {
  key: string; race_date: number; meet: number; rc_no: number;
  actualTop3: string[]; picks: Record<number, string[]>; placeHit: Record<number, boolean>; disagree: boolean;
}

export function buildRaceComparisons(live: LabRow[], shadow: LabRow[]): RaceComparison[] {
  const g = groupBy([...live, ...shadow]);
  const out: RaceComparison[] = [];
  for (const [key, byV] of g) {
    const any = [...byV.values()][0]![0]!;
    const all = [...byV.values()].flat();
    const actual = new Map<string, number>();
    for (const r of all) if (r.actual_ord != null) actual.set(r.hr_name, r.actual_ord);
    const actualTop3 = [...actual.entries()].filter(([, o]) => o >= 1 && o <= 3).sort((a, b) => a[1] - b[1]).map(([h]) => h);
    const picks: Record<number, string[]> = {}, placeHit: Record<number, boolean> = {};
    for (const [v, rows] of byV) {
      picks[v] = [...rows].sort((a, b) => a.predicted_rank - b.predicted_rank).slice(0, 3).map((r) => r.hr_name);
      placeHit[v] = raceHits(rows)?.place ?? false;
    }
    const firsts = new Set(Object.values(picks).map((p) => p[0]));
    out.push({ key, race_date: any.race_date, meet: any.meet, rc_no: any.rc_no, actualTop3, picks, placeHit, disagree: firsts.size > 1 });
  }
  return out.sort((a, b) => b.race_date - a.race_date || a.meet - b.meet || a.rc_no - b.rc_no);
}
