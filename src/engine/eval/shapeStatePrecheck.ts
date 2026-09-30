/**
 * 1단계 사전점검 — 주로 상태 환산이 "다음 경주 초반·종반 시간" 예측을 개선하는가.
 * 스펙 2026-09-30-shape-track-state-adjust-design.md §3.1. 순수 함수(입출력 배열/Map).
 */
import { buildShapeParMap, type ShapeParSourceRow } from '../shapePar.js';
import { horseShapeStats, shapeParKey, type ShapeHistRace } from '../features/shapeSignals.js';
import { toDryTime, fromDryTime } from '../trackStateAdjust.js';

export interface PrecheckRow {
  date: number; meet: number; rcNo: number; hk: string; dist: number;
  state: string | null; g3f: number; fin600: number;
}
export interface SliceStat {
  races: number; horses: number;
  sseOffE: number; sseOnE: number; sseOffL: number; sseOnL: number;
}

const demean = (a: number[]): number[] => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return a.map((v) => v - m);
};

export function precheckRmse(rows: PrecheckRow[], cutoff: number): Map<number, SliceStat> {
  const sorted = [...rows].sort((a, b) => a.date - b.date || a.meet - b.meet || a.rcNo - b.rcNo);
  const toSrc = (adj: boolean): ShapeParSourceRow[] => sorted.map((r) => ({
    raceDate: r.date, meet: r.meet, rcDist: r.dist,
    g3fAcc: adj ? toDryTime(r.g3f, r.state, 'early') : r.g3f,
    fin600: adj ? toDryTime(r.fin600, r.state, 'late') : r.fin600,
  }));
  const parOff = buildShapeParMap(toSrc(false), cutoff);
  const parOn = buildShapeParMap(toSrc(true), cutoff);

  const histOff = new Map<string, ShapeHistRace[]>();
  const histOn = new Map<string, ShapeHistRace[]>();
  const push = (m: Map<string, ShapeHistRace[]>, hk: string, h: ShapeHistRace) => {
    const a = m.get(hk); if (a) a.push(h); else m.set(hk, [h]);
  };
  const out = new Map<number, SliceStat>();

  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i]!;
    let j = i;
    while (j < sorted.length && sorted[j]!.date === first.date && sorted[j]!.meet === first.meet && sorted[j]!.rcNo === first.rcNo) j++;
    const race = sorted.slice(i, j);

    if (first.date >= cutoff) {
      const pk = shapeParKey(first.meet, first.dist);
      const pOff = parOff.get(pk), pOn = parOn.get(pk);
      const predOffE: number[] = [], predOnE: number[] = [], predOffL: number[] = [], predOnL: number[] = [];
      const actE: number[] = [], actL: number[] = [];
      if (pOff && pOn) {
        for (const r of race) {
          const sOff = horseShapeStats(histOff.get(r.hk) ?? [], parOff);
          const sOn = horseShapeStats(histOn.get(r.hk) ?? [], parOn);
          if (!sOff || !sOn) continue;
          predOffE.push(pOff.par3 + sOff.meanD3);
          predOffL.push(pOff.par6 + sOff.meanD6);
          predOnE.push(fromDryTime(pOn.par3 + sOn.meanD3, first.state, 'early'));
          predOnL.push(fromDryTime(pOn.par6 + sOn.meanD6, first.state, 'late'));
          actE.push(r.g3f);
          actL.push(r.fin600);
        }
      }
      if (actE.length >= 2) {
        const aE = demean(actE), aL = demean(actL);
        const sse = (p: number[], a: number[]) => demean(p).reduce((s, v, k) => s + (v - a[k]!) ** 2, 0);
        const year = Math.floor(first.date / 10000);
        const st = out.get(year) ?? { races: 0, horses: 0, sseOffE: 0, sseOnE: 0, sseOffL: 0, sseOnL: 0 };
        st.races += 1; st.horses += actE.length;
        st.sseOffE += sse(predOffE, aE); st.sseOnE += sse(predOnE, aE);
        st.sseOffL += sse(predOffL, aL); st.sseOnL += sse(predOnL, aL);
        out.set(year, st);
      }
    }

    for (const r of race) {
      push(histOff, r.hk, { meet: r.meet, rcDist: r.dist, rcTime: r.g3f + r.fin600, g3fAcc: r.g3f });
      const g3 = toDryTime(r.g3f, r.state, 'early');
      const f6 = toDryTime(r.fin600, r.state, 'late');
      push(histOn, r.hk, { meet: r.meet, rcDist: r.dist, rcTime: g3 + f6, g3fAcc: g3 });
    }
    i = j;
  }
  return out;
}

const rel = (off: number, on: number): number => (off > 0 ? 1 - Math.sqrt(on / off) : 0);

export function judgePrecheck(
  stats: Map<number, SliceStat>, minRel = 0.01, minSlices = 2,
): { pass: boolean; slices: Array<{ year: number; relEarly: number; relLate: number; ok: boolean }> } {
  const slices = [...stats.entries()].sort((a, b) => a[0] - b[0]).map(([year, s]) => {
    const relEarly = rel(s.sseOffE, s.sseOnE);
    const relLate = rel(s.sseOffL, s.sseOnL);
    return { year, relEarly, relLate, ok: relEarly >= minRel || relLate >= minRel };
  });
  return { pass: slices.filter((x) => x.ok).length >= minSlices, slices };
}
