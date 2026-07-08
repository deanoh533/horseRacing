/**
 * 경주 전개 par(거리 표준 기록) — meet×rc_dist 중앙값.
 * 스펙 §3: cutoffDate '미만' 데이터만 반영 (벤치마크=20250101 고정, 라이브=rcDate → 자동 as-of).
 * 소스 행은 프로세스당 1회 로드, ShapeParMap은 cutoff별 메모이즈 (speedFigure.loadParMap 선례).
 */
import type { ReadClient } from '../db/localDb.js';
import { shapeParKey, type ShapeParMap } from './features/shapeSignals.js';

/** 버킷 유효 최소 행수 (희소 거리 노이즈 차단, 튜닝 대상) */
export const SHAPE_PAR_MIN_ROWS = 30;

export interface ShapeParSourceRow {
  raceDate: number;
  meet: number;
  rcDist: number;
  g3fAcc: number;
  fin600: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function buildShapeParMap(rows: ShapeParSourceRow[], cutoffDate: number): ShapeParMap {
  const buckets = new Map<string, { g3: number[]; f6: number[] }>();
  for (const r of rows) {
    if (r.raceDate >= cutoffDate) continue;
    const k = shapeParKey(r.meet, r.rcDist);
    const b = buckets.get(k);
    if (b) { b.g3.push(r.g3fAcc); b.f6.push(r.fin600); }
    else buckets.set(k, { g3: [r.g3fAcc], f6: [r.fin600] });
  }
  const map: ShapeParMap = new Map();
  for (const [k, b] of buckets) {
    if (b.g3.length < SHAPE_PAR_MIN_ROWS) continue;
    map.set(k, { par3: median(b.g3.sort((a, c) => a - c)), par6: median(b.f6.sort((a, c) => a - c)) });
  }
  return map;
}

// fin600 유효범위 — shapeSignals와 동일 기준 (스펙 §2.1)
const FIN600_MIN = 30;
const FIN600_MAX = 60;

let _sourceCache: ShapeParSourceRow[] | null = null;
const _mapCache = new Map<number, ShapeParMap>();

/** race_entries 전체에서 par 소스 행 로드 (프로세스 1회). */
async function loadShapeParSource(sb: ReadClient): Promise<ShapeParSourceRow[]> {
  if (_sourceCache) return _sourceCache;
  const rows: ShapeParSourceRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_dist, rc_time, se_g3f_acc_time, bu_g3f_acc_time')
      .not('ord', 'is', null)
      .not('rc_time', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('pthr_no') // 결정적 페이지 경계
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_dist: number | null; rc_time: number | null; se_g3f_acc_time: number | null; bu_g3f_acc_time: number | null }>) {
      const g3fAcc = r.meet === 1 ? r.se_g3f_acc_time : r.bu_g3f_acc_time;
      if (r.rc_dist == null || r.rc_time == null || g3fAcc == null || !(g3fAcc > 0)) continue;
      const fin600 = r.rc_time - g3fAcc;
      if (fin600 < FIN600_MIN || fin600 > FIN600_MAX) continue;
      rows.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, g3fAcc, fin600 });
    }
    if (data.length < PAGE) break;
  }
  _sourceCache = rows;
  return rows;
}

export async function shapeParMapAsOf(sb: ReadClient, cutoffDate: number): Promise<ShapeParMap> {
  const hit = _mapCache.get(cutoffDate);
  if (hit) return hit;
  const map = buildShapeParMap(await loadShapeParSource(sb), cutoffDate);
  _mapCache.set(cutoffDate, map);
  return map;
}
