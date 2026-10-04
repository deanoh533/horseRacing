/** W-006 엇갈린 경주 해부 — 모델 1순위 ≠ 인기 1위 경주를 묶음별로 집계 (순수). */

export interface DisRow {
  modelOrd: number;
  favOrd: number;
  modelOdds: number;   // 모델 픽 단승 배당(확정)
  favOdds: number;
  dims: Record<string, string>;
}

export interface SliceStat {
  bucket: string;
  n: number;
  modelWin: number; modelShow: number; modelRoi: number;
  favWin: number; favShow: number; favRoi: number;
}

/** edges 오름차순. 값 < edges[0] → labels[0], … , ≥ 마지막 → labels[last]. NaN → '결측'. */
export function bucket(v: number, edges: number[], labels: string[]): string {
  if (!Number.isFinite(v)) return '결측';
  let i = 0;
  while (i < edges.length && v >= edges[i]!) i++;
  return labels[i]!;
}

export function sliceDisagreement(rows: DisRow[], dim: string): SliceStat[] {
  const acc = new Map<string, SliceStat>();
  for (const r of rows) {
    const b = r.dims[dim] ?? '결측';
    const s = acc.get(b) ?? { bucket: b, n: 0, modelWin: 0, modelShow: 0, modelRoi: 0, favWin: 0, favShow: 0, favRoi: 0 };
    s.n++;
    if (r.modelOrd === 1) { s.modelWin++; s.modelRoi += r.modelOdds; }
    if (r.modelOrd <= 3) s.modelShow++;
    if (r.favOrd === 1) { s.favWin++; s.favRoi += r.favOdds; }
    if (r.favOrd <= 3) s.favShow++;
    acc.set(b, s);
  }
  return [...acc.values()]
    .map((s) => ({ ...s, modelWin: s.modelWin / s.n, modelShow: s.modelShow / s.n, modelRoi: s.modelRoi / s.n,
      favWin: s.favWin / s.n, favShow: s.favShow / s.n, favRoi: s.favRoi / s.n }))
    .sort((a, b) => b.n - a.n);
}
