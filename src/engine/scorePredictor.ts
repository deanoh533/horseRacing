/**
 * Score Predictor
 * - 한 경주의 출전마 전체에 대해 Score Engine 입력을 준비하고 호출
 * - DB에서 과거 이력을 모아 17개 항목 입력을 채움
 * - 결과를 predictions 테이블 row 형태로 반환
 *
 * 데이터 부족 항목은 빈 배열/0 으로 호출 → Score Engine이 0점 처리
 * (예: 데뷔말 → 이력 0건 → 이력 의존 항목 0점, 의도된 동작)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScoreEngine, type HorseScoreResult } from './index.js';

interface HorseRow {
  race_date: number;
  meet: number;
  rc_no: number;
  chul_no: number;
  hr_name: string;
  hr_no: string;
  age: number | null;
  sex: string | null;
  rating: number | null;
  ord: number | null;
  st_ord: number | null;
  rc_dist: number | null;
  track_type: string | null;
  wg_budam: number | null;
  jk_no: string | null;
  tr_no: string | null;
  popularity: number | null;
}

export interface PredictionRow {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  total_score: number;
  predicted_rank: number;
  item_scores: HorseScoreResult['items'];
  actual_ord: number | null;
}

const engine = new ScoreEngine();

export async function predictRace(
  sb: SupabaseClient,
  rcDate: number,
  meet: number,
  rcNo: number
): Promise<PredictionRow[]> {
  // 1. 출전마 전체
  const { data: horses, error } = await sb
    .from('horse_results')
    .select('*')
    .eq('race_date', rcDate)
    .eq('meet', meet)
    .eq('rc_no', rcNo)
    .order('chul_no');
  if (error) throw error;
  if (!horses || horses.length === 0) return [];

  const horseList = horses as HorseRow[];
  const totalHorses = horseList.length;

  // 2. 같은 계절 판단용 (rcDate → 월)
  const currentMonth = Math.floor((rcDate % 10000) / 100);
  const currentSeason = monthToSeason(currentMonth);

  // 3. 각 말의 점수 계산
  const results = await Promise.all(
    horseList.map(async (h) => {
      const input = await buildEngineInput(sb, h, totalHorses, currentMonth, currentSeason);
      const score = engine.calculateScores(input);
      return { horse: h, score };
    })
  );

  // 4. predicted_rank 부여 (total_score 내림차순)
  const sorted = [...results].sort((a, b) => b.score.total - a.score.total);
  const rankMap = new Map<number, number>(); // chul_no → rank
  sorted.forEach((r, idx) => rankMap.set(r.horse.chul_no, idx + 1));

  // 5. PredictionRow 변환
  return results.map((r) => ({
    race_date: rcDate,
    meet,
    rc_no: rcNo,
    hr_name: r.horse.hr_name,
    total_score: r.score.total,
    predicted_rank: rankMap.get(r.horse.chul_no)!,
    item_scores: r.score.items,
    actual_ord: r.horse.ord,
  }));
}

async function buildEngineInput(
  sb: SupabaseClient,
  h: HorseRow,
  totalHorses: number,
  currentMonth: number,
  currentSeason: 'spring' | 'summer' | 'autumn' | 'winter'
) {
  const rcDate = h.race_date;

  // 같은 말의 과거 5경주
  const { data: hist5raw } = await sb
    .from('horse_results')
    .select('race_date, meet, rc_no, ord, rc_dist, track, track_type, wg_hr_diff, wg_budam, win_odds, popularity, jk_no, rc_time')
    .eq('hr_name', h.hr_name)
    .lt('race_date', rcDate)
    .order('race_date', { ascending: false })
    .limit(5);
  const hist5 = hist5raw ?? [];
  const histAsc = [...hist5].reverse();

  // ⑧ 부담 극복 지수용: 과거 5경주의 raceAvgBudam을 한번에 batch fetch
  // (각 과거 경주의 전체 출전마 부담중량 평균)
  const burdenHistory = await buildBurdenHistory(sb, hist5);

  // 같은 거리 (5경주 전체에서)
  const sameDistOrds = hist5
    .filter((r) => r.rc_dist === h.rc_dist && r.ord != null)
    .map((r) => r.ord as number);

  // 같은 거리 + 같은 주로 시간(④)
  const sameDistTrackTimes = hist5
    .filter((r) => r.rc_dist === h.rc_dist && r.track_type === h.track_type && r.rc_time != null)
    .map((r) => ({ rcTime: r.rc_time as number, lastFurlong: 0 }));
  const sameDistOnlyTimes = hist5
    .filter((r) => r.rc_dist === h.rc_dist && r.rc_time != null)
    .map((r) => ({ rcTime: r.rc_time as number, lastFurlong: 0 }));

  // 주로 적응(⑦): 전체 이력 vs 같은 주로
  const overallOrds = hist5.filter((r) => r.ord != null).map((r) => r.ord as number);
  const sameTrackOrds = hist5
    .filter((r) => r.track_type === h.track_type && r.ord != null)
    .map((r) => r.ord as number);

  // 기수 30일 이력(⑨)
  const thirtyDaysAgo = subtractDays(rcDate, 30);
  let jockey30DayOrds: number[] = [];
  if (h.jk_no) {
    const { data: jk } = await sb
      .from('horse_results')
      .select('ord')
      .eq('jk_no', h.jk_no)
      .gte('race_date', thirtyDaysAgo)
      .lt('race_date', rcDate);
    jockey30DayOrds = (jk ?? []).filter((r) => r.ord != null).map((r) => r.ord as number);
  }

  // 조교사 60일 이력(⑩)
  const sixtyDaysAgo = subtractDays(rcDate, 60);
  let trainer60DayOrds: number[] = [];
  if (h.tr_no) {
    const { data: tr } = await sb
      .from('horse_results')
      .select('ord')
      .eq('tr_no', h.tr_no)
      .gte('race_date', sixtyDaysAgo)
      .lt('race_date', rcDate);
    trainer60DayOrds = (tr ?? []).filter((r) => r.ord != null).map((r) => r.ord as number);
  }

  // 경주 간격(⑪): 직전 출전 ~ 이번 경주
  let intervalDays: number | null = null;
  if (histAsc.length > 0) {
    const lastDate = histAsc[histAsc.length - 1]!.race_date as number;
    intervalDays = daysBetween(lastDate, rcDate);
  }

  // 같은 계절(⑮): 작년 같은 계절 이력
  let sameSeasonOrds: number[] = [];
  const { data: seasonRaw } = await sb
    .from('horse_results')
    .select('race_date, ord')
    .eq('hr_name', h.hr_name)
    .lt('race_date', rcDate);
  sameSeasonOrds = (seasonRaw ?? [])
    .filter((r) => r.ord != null && monthToSeason(Math.floor((r.race_date % 10000) / 100)) === currentSeason)
    .map((r) => r.ord as number);

  // 기수-말 궁합(⑯): 같은 jk_no + hr_name 조합
  let combinationOrds: number[] = [];
  if (h.jk_no) {
    const { data: combRaw } = await sb
      .from('horse_results')
      .select('ord')
      .eq('hr_name', h.hr_name)
      .eq('jk_no', h.jk_no)
      .lt('race_date', rcDate);
    combinationOrds = (combRaw ?? []).filter((r) => r.ord != null).map((r) => r.ord as number);
  }
  const horseAllOrds = (seasonRaw ?? []).filter((r) => r.ord != null).map((r) => r.ord as number);

  // 배당률(⑰): 최근 5경주 인기
  const recent5Popularities = hist5
    .filter((r) => r.popularity != null)
    .map((r) => r.popularity as number);

  return {
    rating: h.rating ?? 0,
    weightDiffs: histAsc.map((r) => r.wg_hr_diff ?? 0),
    sex: h.sex ?? undefined,
    currentMonth,
    ord5: histAsc.filter((r) => r.ord != null).map((r) => r.ord as number),
    sameDistTrackTimes,
    sameDistOnlyTimes,
    positions: [], // ⑤ 후반 구간: KRA bu_g*f_ord 컬럼 0으로 채워져 있어 미사용
    sameDistOrds,
    overallOrds,
    sameTrackOrds,
    burdenHistory,
    jockey30DayOrds,
    trainer60DayOrds,
    intervalDays,
    // ⑫ 출발번호: KRA st_ord는 결승순위(cheating)였음. 진짜 게이트 번호는 chul_no
    //  (API314/316 출주표 검증: pthrNo == chul_no, ord와 무관)
    stOrd: h.chul_no,
    totalHorses,
    rcDist: h.rc_dist ?? 0,
    age: h.age ?? 0,
    pedigree: {}, // ⑭ 혈통: API284 데이터 미동기화 → 빈값
    sameSeasonOrds,
    horseAllOrds,
    combinationOrds,
    recent5Popularities,
  };
}

/**
 * ⑧ 부담 극복 지수용 — 과거 경주들의 raceAvgBudam 일괄 fetch
 * 한 horse의 hist5 (~5경주) 각각의 출전마 전체 평균 부담중량
 */
async function buildBurdenHistory(
  sb: SupabaseClient,
  hist5: any[]
): Promise<Array<{ ord: number; myBudam: number; raceAvgBudam: number }>> {
  if (hist5.length === 0) return [];
  // (race_date, meet, rc_no) 키 목록
  const validHist = hist5.filter((h) => h.ord != null && h.wg_budam != null);
  if (validHist.length === 0) return [];

  // 각 경주의 모든 wg_budam 가져오기 (OR 조건으로 batch)
  const results: Array<{ ord: number; myBudam: number; raceAvgBudam: number }> = [];
  for (const h of validHist) {
    const { data: peers } = await sb
      .from('horse_results')
      .select('wg_budam')
      .eq('race_date', h.race_date)
      .eq('meet', h.meet)
      .eq('rc_no', h.rc_no);
    const budams = (peers ?? []).map((p) => p.wg_budam).filter((v): v is number => v != null);
    if (budams.length === 0) continue;
    const raceAvgBudam = budams.reduce((s, v) => s + v, 0) / budams.length;
    results.push({
      ord: h.ord as number,
      myBudam: h.wg_budam as number,
      raceAvgBudam,
    });
  }
  return results;
}

function monthToSeason(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function subtractDays(rcDate: number, days: number): number {
  const date = rcDateToDate(rcDate);
  date.setDate(date.getDate() - days);
  return dateToRcDate(date);
}

function daysBetween(from: number, to: number): number {
  const a = rcDateToDate(from);
  const b = rcDateToDate(to);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function rcDateToDate(rcDate: number): Date {
  const y = Math.floor(rcDate / 10000);
  const m = Math.floor((rcDate % 10000) / 100) - 1;
  const d = rcDate % 100;
  return new Date(y, m, d);
}

function dateToRcDate(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
