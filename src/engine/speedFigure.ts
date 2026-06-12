/**
 * ⑳ 속도능력지수 — 순수 산식 + DB 보조
 *
 * figure(말,경주) = par_time(버킷) / rc_time  (1보다 크면 기준 우승마보다 빠름)
 * 거리·주로별 par로 정규화 → 클래스가 시간에 녹아든 절대 능력 척도.
 * 집계는 반드시 as-of(과거 경주만). 자세한 근거: docs/superpowers/specs/2026-06-03-speed-figure-design.md
 */
import type { ReadClient } from '../db/localDb.js';

/** par 유효 최소 우승표본 (튜닝 대상) */
export const PAR_MIN_WINS = 10;

/** 버킷 키 = meet|거리|주로 */
export function parBucketKey(meet: number, rcDist: number, trackType: string): string {
  return `${meet}|${rcDist}|${trackType}`;
}

/** 한 경주 figure = par_time / rc_time. 유효하지 않으면 null */
export function raceSpeedFigure(rcTime: number, parTime: number): number | null {
  if (!(rcTime > 0) || !(parTime > 0)) return null;
  return parTime / rcTime;
}

/** 최신순 figures의 최근 N개 평균. 빈 배열이면 null */
export function computeAbilityRaw(figures: number[], n: number): number | null {
  if (figures.length === 0) return null;
  const recent = figures.slice(0, n);
  return recent.reduce((s, v) => s + v, 0) / recent.length;
}

/**
 * as-of 누수 차단: 타임라인(최신순 {date,fig})에서 beforeDate '미만'만 figure로 추출.
 * 예측 대상 경주 당일·이후는 제외 (착순 훔쳐보기 방지).
 */
export function figuresBeforeDate(
  timeline: { date: number; fig: number }[],
  beforeDate: number
): number[] {
  return timeline.filter((t) => t.date < beforeDate).map((t) => t.fig);
}

/** race_par_times view → 버킷키→par_time 맵 (n_wins>=PAR_MIN_WINS만).
 *  정적 기준표 → 프로세스 1회만 로드(메모이즈). extract 수천경주 재로드 방지. */
let _parMapCache: Map<string, number> | null = null;
export async function loadParMap(sb: ReadClient): Promise<Map<string, number>> {
  if (_parMapCache) return _parMapCache;
  const map = new Map<string, number>();
  const { data, error } = await sb
    .from('race_par_times')
    .select('meet, rc_dist, track_type, par_time, n_wins');
  if (error) throw error;
  for (const r of (data ?? []) as Array<{ meet: number; rc_dist: number; track_type: string; par_time: number; n_wins: number }>) {
    if (r.n_wins >= PAR_MIN_WINS && r.par_time > 0) {
      map.set(parBucketKey(r.meet, r.rc_dist, r.track_type), r.par_time);
    }
  }
  _parMapCache = map;
  return map;
}
