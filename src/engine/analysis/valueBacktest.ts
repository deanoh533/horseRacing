/**
 * Stage 2 Phase 1 — value 베팅 백테스트 순수 헬퍼.
 * 베팅 선정(배당구간 train 컷오프)·정산(plc_odds)·ROI 집계. DB/IO 없음.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-phase1-value-betting-design.md
 */
import { oddsBand } from './edgeProbe.js';

/** 오름차순 정렬 후 q 분위의 값(하한 인덱스). q=2/3 → 상위 1/3 경계. */
export function quantileCutoff(scores: number[], q: number): number {
  if (scores.length === 0) return Infinity;
  const sorted = [...scores].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(q * sorted.length), sorted.length - 1);
  return sorted[idx]!;
}

/** 각 배당구간에서 말 점수의 상위 1/3 경계 컷오프(2/3 분위). na 배당 무시. */
export function topTercileCutoffs(recs: { odds: number; score: number }[]): Record<string, number> {
  const byBand = new Map<string, number[]>();
  for (const r of recs) {
    const b = oddsBand(r.odds);
    if (b === 'na') continue;
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b)!.push(r.score);
  }
  const out: Record<string, number> = {};
  for (const [b, scores] of byBand) out[b] = quantileCutoff(scores, 2 / 3);
  return out;
}

/** 베팅 여부: 점수가 해당 배당구간 컷오프 이상이면 true. */
export function isBet(odds: number, score: number, cutoffs: Record<string, number>): boolean {
  const b = oddsBand(odds);
  if (b === 'na') return false;
  const c = cutoffs[b];
  return c != null && score >= c;
}

export interface Bet { band: string; plcOdds: number | null }
export interface BandSummary {
  band: string; nBets: number; nHits: number; hitRate: number; avgOdds: number; roi: number;
}

/** 정액 베팅 ROI. 입상(plcOdds!=null) 시 회수=plcOdds, 미입상 0. ROI=Σ회수/nBets−1. */
export function roi(bets: Bet[]): number {
  if (bets.length === 0) return 0;
  const ret = bets.reduce((s, b) => s + (b.plcOdds != null ? b.plcOdds : 0), 0);
  return ret / bets.length - 1;
}

const BAND_ORDER = ['<2', '2-4', '4-7', '7-15', '15-30', '30+'];

/** 배당구간별 집계(고정 순서, 빈 구간 제외). */
export function summarize(bets: Bet[]): BandSummary[] {
  const byBand = new Map<string, Bet[]>();
  for (const b of bets) {
    if (!byBand.has(b.band)) byBand.set(b.band, []);
    byBand.get(b.band)!.push(b);
  }
  const out: BandSummary[] = [];
  for (const band of BAND_ORDER) {
    const rows = byBand.get(band);
    if (!rows || rows.length === 0) continue;
    const hits = rows.filter((r) => r.plcOdds != null);
    const avgOdds = hits.length ? hits.reduce((s, r) => s + (r.plcOdds as number), 0) / hits.length : 0;
    out.push({ band, nBets: rows.length, nHits: hits.length, hitRate: hits.length / rows.length, avgOdds, roi: roi(rows) });
  }
  return out;
}
