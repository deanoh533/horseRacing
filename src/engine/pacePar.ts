/**
 * 초반 페이스 par(meet×rc_dist별 avg_s1f 중앙값) — 과거 경주 실측 페이스 라벨링용.
 * shapePar.ts 선례: 소스 프로세스 1회 로드 + cutoff별 메모이즈. cutoff '미만'만 반영.
 * 소스 = race_sectional_stats (경주당 1행).
 * 스펙: docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md §3
 */
import type { ReadClient } from '../db/localDb.js';

export const PACE_PAR_MIN_ROWS = 30;

export type PaceParMap = Map<string, number>;

export function paceParKey(meet: number, rcDist: number): string {
  return `${meet}|${rcDist}`;
}

export interface PaceParSourceRow {
  raceDate: number;
  meet: number;
  rcDist: number;
  avgS1f: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function buildPaceParMap(rows: PaceParSourceRow[], cutoffDate: number): PaceParMap {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    if (r.raceDate >= cutoffDate) continue;
    const k = paceParKey(r.meet, r.rcDist);
    const b = buckets.get(k);
    if (b) b.push(r.avgS1f); else buckets.set(k, [r.avgS1f]);
  }
  const map: PaceParMap = new Map();
  for (const [k, b] of buckets) {
    if (b.length < PACE_PAR_MIN_ROWS) continue;
    map.set(k, median(b.sort((a, c) => a - c)));
  }
  return map;
}

let _sourceCache: PaceParSourceRow[] | null = null;
const _mapCache = new Map<number, PaceParMap>();

async function loadPaceParSource(sb: ReadClient): Promise<PaceParSourceRow[]> {
  if (_sourceCache) return _sourceCache;
  const rows: PaceParSourceRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f')
      .order('race_date').order('meet').order('rc_no') // 결정적 페이지 경계
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_dist: number | null; avg_s1f: number | null }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(r.avg_s1f > 0)) continue;
      rows.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
    }
    if (data.length < PAGE) break;
  }
  _sourceCache = rows;
  return rows;
}

export async function paceParMapAsOf(sb: ReadClient, cutoffDate: number): Promise<PaceParMap> {
  const hit = _mapCache.get(cutoffDate);
  if (hit) return hit;
  const map = buildPaceParMap(await loadPaceParSource(sb), cutoffDate);
  _mapCache.set(cutoffDate, map);
  return map;
}
