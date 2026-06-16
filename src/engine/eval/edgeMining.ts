import { rankHorses, type ScorableModel } from './score.js';
import { rankByOdds } from './market.js';
import { quarterKey } from './rolling.js';
import type { RaceRecord } from './types.js';

export interface SegmentLabels {
  favOddsBand: string;
  fieldBand: string;
  distBand: string;
  disagreeStrength: string;
}

/** 한 경주의 조건 라벨. 임계값은 2026-06-16 probe로 확정(스펙 §4.1). */
export function conditionRace(p: {
  favWinOdds: number;
  fieldSize: number;
  rcDist: number;
  favModelRank: number; // 1-based: 인기1위가 모델 순위에서 몇 등인가
}): SegmentLabels {
  // 배당대 경계 = 인기1위 win_odds 분위수(2026-06-16 probe: p25=1.8·p50=2.3·p75=2.9).
  const favOddsBand =
    p.favWinOdds <= 1.8 ? 'fav<=1.8'
    : p.favWinOdds <= 2.3 ? 'fav1.8-2.3'
    : p.favWinOdds <= 2.9 ? 'fav2.3-2.9'
    : 'fav>2.9';
  const fieldBand =
    p.fieldSize <= 9 ? 'field<=9'
    : p.fieldSize <= 11 ? 'field10-11'
    : 'field>=12';
  const distBand =
    p.rcDist <= 1400 ? 'dist<=1400'
    : p.rcDist <= 1700 ? 'dist1401-1700'
    : 'dist>1700';
  const disagreeStrength =
    p.favModelRank <= 2 ? 'dis2'
    : p.favModelRank === 3 ? 'dis3'
    : 'dis>=4';
  return { favOddsBand, fieldBand, distBand, disagreeStrength };
}

export interface EdgeRow {
  quarterKey: string;
  labels: SegmentLabels;
  modelPickOrd: number;
  favPickOrd: number;
}

/** 모델top1 ≠ 인기top1 인 경주만 1행으로 기록. */
export function recordEdges(races: RaceRecord[], model: ScorableModel): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const race of races) {
    const modelOrder = rankHorses(model, race.horses);
    const mktOrder = rankByOdds(race.horses); // win_odds 오름차순, 유효 배당만
    const mPick = modelOrder[0];
    const fPick = mktOrder[0];
    if (!mPick || !fPick) continue;
    if (mPick.hrName === fPick.hrName) continue;
    if (mPick.ord == null || fPick.ord == null) continue;
    const favModelRank = modelOrder.findIndex((h) => h.hrName === fPick.hrName) + 1;
    const labels = conditionRace({
      favWinOdds: fPick.winOdds as number,
      fieldSize: race.horses.length,
      rcDist: race.rcDist ?? 0,
      favModelRank,
    });
    rows.push({
      quarterKey: quarterKey(race.raceDate),
      labels,
      modelPickOrd: mPick.ord,
      favPickOrd: fPick.ord,
    });
  }
  return rows;
}

export interface QuarterCell { key: string; n: number; placeEdge: number; }
export interface SegmentStat {
  segment: string;
  totalN: number;
  quarters: QuarterCell[];
  qualifyingQuarters: number;
  positiveQuarters: number;
  pooledWinEdge: number;
  pooledTop2Edge: number;
  pooledPlaceEdge: number;
  verdict: '채택후보' | '혼조' | '보류';
}
export interface AggOptions { minCellN: number; minQuarters: number; positiveRatio: number; combos: boolean; }

const DIMS = ['favOddsBand', 'fieldBand', 'distBand', 'disagreeStrength'] as const;

/** 한 행이 속한 모든 구간 키(단일 4개 + combos면 2차 6개). */
function segmentKeysFor(labels: SegmentLabels, combos: boolean): string[] {
  const singles = DIMS.map((d) => `${d}=${labels[d]}`);
  if (!combos) return singles;
  const pairs: string[] = [];
  for (let i = 0; i < DIMS.length; i++)
    for (let j = i + 1; j < DIMS.length; j++)
      pairs.push(`${DIMS[i]}=${labels[DIMS[i]!]} ∩ ${DIMS[j]}=${labels[DIMS[j]!]}`);
  return [...singles, ...pairs];
}

/** 픽 착순 ≤ thr 비율의 모델−인기 차이. */
function edge(rows: EdgeRow[], thr: number): number {
  const n = rows.length;
  if (n === 0) return 0;
  const m = rows.filter((r) => r.modelPickOrd <= thr).length / n;
  const f = rows.filter((r) => r.favPickOrd <= thr).length / n;
  return m - f;
}

export function aggregate(rows: EdgeRow[], opts: AggOptions): SegmentStat[] {
  const bySeg = new Map<string, EdgeRow[]>();
  for (const row of rows)
    for (const seg of segmentKeysFor(row.labels, opts.combos)) {
      if (!bySeg.has(seg)) bySeg.set(seg, []);
      bySeg.get(seg)!.push(row);
    }

  const stats: SegmentStat[] = [];
  for (const [segment, segRows] of bySeg) {
    const byQ = new Map<string, EdgeRow[]>();
    for (const r of segRows) {
      if (!byQ.has(r.quarterKey)) byQ.set(r.quarterKey, []);
      byQ.get(r.quarterKey)!.push(r);
    }
    const quarters: QuarterCell[] = [...byQ.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, qr]) => ({ key, n: qr.length, placeEdge: edge(qr, 3) }));
    const qualifying = quarters.filter((q) => q.n >= opts.minCellN);
    const positive = qualifying.filter((q) => q.placeEdge > 0);
    const verdict: SegmentStat['verdict'] =
      qualifying.length < opts.minQuarters ? '보류'
      : positive.length / qualifying.length >= opts.positiveRatio ? '채택후보'
      : '혼조';
    stats.push({
      segment,
      totalN: segRows.length,
      quarters,
      qualifyingQuarters: qualifying.length,
      positiveQuarters: positive.length,
      pooledWinEdge: edge(segRows, 1),
      pooledTop2Edge: edge(segRows, 2),
      pooledPlaceEdge: edge(segRows, 3),
      verdict,
    });
  }
  return stats;
}
