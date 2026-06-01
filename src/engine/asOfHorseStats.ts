/**
 * As-of 마별 통계 (누수 방지)
 *
 * ⚠️ 배경: horse_sectional_ability / horse_running_style_by_distance 뷰는 마별 전체
 *    집계라 "예측 대상 경주"의 결과까지 포함한다(look-ahead 누수). 백필(사후)로 과거
 *    경주를 예측할 때 ⑤⑥⑫⑲ rawScore가 정답을 훔쳐보게 됨.
 *
 * 해결: 뷰와 동일한 공식을, 그 말의 *과거* 경주(race_date < 예측경주)로만 재계산한다.
 *    현재 경주가 자동 제외되어 누수가 사라진다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type DistCategory = 'short' | 'middle' | 'long';

export interface AsOfPastRace {
  s1fOrd: number | null; // 출발(첫 200m) 순위, 서울 sj / 부경 bu
  ord: number | null; // 결승 순위
  fieldSize: number; // 그 경주 출전두수
  distCategory: DistCategory | null;
}

export interface AsOfHorseStats {
  avgPositionRatio: number | null; // ⑫⑲
  stddevPositionRatio: number | null; // ⑫⑲
  frontRunSuccessRate: number | undefined; // ⑤
  distFinishRatio: number | null; // ⑥ (현재 경주 거리 카테고리 한정)
}

// 뷰의 HAVING 임계와 동일
const MIN_RACES_POSITION = 3; // horse_sectional_ability HAVING COUNT(*) >= 3
const MIN_RACES_DIST = 2; // horse_running_style_by_distance HAVING COUNT(*) >= 2

const EMPTY: AsOfHorseStats = {
  avgPositionRatio: null,
  stddevPositionRatio: null,
  frontRunSuccessRate: undefined,
  distFinishRatio: null,
};

export function distCategoryOf(dist: number | null | undefined): DistCategory | null {
  if (dist == null) return null;
  if (dist < 1400) return 'short';
  if (dist <= 1800) return 'middle';
  return 'long';
}

/** 순수 함수: 과거 경주 배열 → as-of 통계 (뷰 공식의 leak-free 버전) */
export function computeAsOfHorseStats(
  past: AsOfPastRace[],
  currentDistCategory: DistCategory | null
): AsOfHorseStats {
  if (past.length === 0) return { ...EMPTY };

  const posRatios: number[] = [];
  const frontPairs: { pos: number; fin: number }[] = []; // position_ratio + finish_ratio
  for (const r of past) {
    if (r.fieldSize < 2) continue;
    const denom = r.fieldSize - 1;
    if (r.s1fOrd != null && r.s1fOrd > 0) {
      const pos = (r.s1fOrd - 1) / denom;
      posRatios.push(pos);
      if (r.ord != null) frontPairs.push({ pos, fin: (r.ord - 1) / denom });
    }
  }

  let avgPositionRatio: number | null = null;
  let stddevPositionRatio: number | null = null;
  let frontRunSuccessRate: number | undefined = undefined;
  if (posRatios.length >= MIN_RACES_POSITION) {
    avgPositionRatio = mean(posRatios);
    stddevPositionRatio = sampleStddev(posRatios);
    const front = frontPairs.filter((p) => p.pos <= 0.3); // 출발 상위 30%
    if (front.length > 0) {
      frontRunSuccessRate = front.filter((p) => p.fin <= 0.3).length / front.length;
    }
  }

  // ⑥: 현재 경주 거리 카테고리의 과거 finish_ratio 평균
  let distFinishRatio: number | null = null;
  if (currentDistCategory) {
    const fins: number[] = [];
    for (const r of past) {
      if (r.distCategory !== currentDistCategory) continue;
      if (r.fieldSize < 2 || r.ord == null) continue;
      fins.push((r.ord - 1) / (r.fieldSize - 1));
    }
    if (fins.length >= MIN_RACES_DIST) distFinishRatio = mean(fins);
  }

  return { avgPositionRatio, stddevPositionRatio, frontRunSuccessRate, distFinishRatio };
}

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function sampleStddev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}

/**
 * DB에서 그 말의 과거 경주를 가져와 as-of 통계 계산.
 * field_size는 race_sectional_stats 뷰(경주별 horses 카운트)에서 조회.
 */
export async function fetchAsOfHorseStats(
  sb: SupabaseClient,
  hrName: string,
  beforeDate: number,
  currentDistCategory: DistCategory | null
): Promise<AsOfHorseStats> {
  const { data: pastRaw } = await sb
    .from('race_entries')
    .select('race_date, meet, rc_no, ord, rc_dist, sj_s1f_ord, bu_s1f_ord')
    .eq('hr_name', hrName)
    .lt('race_date', beforeDate)
    .not('ord', 'is', null)
    .order('race_date', { ascending: false })
    .limit(60);
  const past = (pastRaw ?? []) as Array<{
    race_date: number; meet: number; rc_no: number; ord: number | null;
    rc_dist: number | null; sj_s1f_ord: number | null; bu_s1f_ord: number | null;
  }>;
  if (past.length === 0) return { ...EMPTY };

  // field_size: 과거 경주들의 출전두수 (race_sectional_stats.horses)
  const dates = [...new Set(past.map((r) => r.race_date))];
  const fsMap = new Map<string, number>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_sectional_stats')
      .select('race_date, meet, rc_no, horses')
      .in('race_date', dates)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_no: number; horses: number }>) {
      fsMap.set(`${r.race_date}-${r.meet}-${r.rc_no}`, r.horses);
    }
    if (data.length < PAGE) break;
  }

  const races: AsOfPastRace[] = past.map((r) => ({
    s1fOrd: (r.meet === 1 ? r.sj_s1f_ord : r.bu_s1f_ord) ?? null,
    ord: r.ord ?? null,
    fieldSize: fsMap.get(`${r.race_date}-${r.meet}-${r.rc_no}`) ?? 0,
    distCategory: distCategoryOf(r.rc_dist),
  }));
  return computeAsOfHorseStats(races, currentDistCategory);
}
