/**
 * Score Predictor
 * - 한 경주의 출전마 전체에 대해 Score Engine 입력을 준비하고 호출
 * - race_entries 테이블에서 사전/사후 자동 분기
 *   - ord가 null  → 사전 모드 (출주표 기반 예측)
 *   - ord가 있음  → 사후 모드 (결과 포함 백테스트)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScoreEngine, type HorseScoreResult, type ScoreEngineInput } from './index.js';
import { getActiveModelVersion } from './modelVersion.js';
import { scoreLogistic } from './logisticScorer.js';
import { fetchAsOfHorseStats, distCategoryOf, type AsOfHorseStats } from './asOfHorseStats.js';
import { loadParMap } from './speedFigure.js';

interface EntryRow {
  race_date: number;
  meet: number;
  rc_no: number;
  pthr_no: number;
  hr_name: string;
  hr_no: string | null;
  ag: number | null;
  gndr: string | null;
  ratg: number | null;
  ord: number | null;
  rc_dist: number | null;
  track_type: string | null;
  burd_wgt: number | null;
  jcky_no: string | null;
  trar_no: string | null;
  popularity: number | null;
  erng_sump: number | null;
  erng_sump_asof: number | null;
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
  model_version: number | null;   // 이 예측을 만든 활성 버전 도장
}

export interface RaceInputRow {
  hr_name: string;
  pthr_no: number;
  ord: number | null;
  input: ScoreEngineInput;
}

export async function gatherRaceInputs(
  sb: SupabaseClient,
  rcDate: number,
  meet: number,
  rcNo: number
): Promise<RaceInputRow[]> {
  // race_entries에서 조회 (사전/사후 자동 분기)
  const { data: entries, error } = await sb
    .from('race_entries')
    .select('race_date, meet, rc_no, pthr_no, hr_name, hr_no, ag, gndr, ratg, ord, rc_dist, track_type, burd_wgt, jcky_no, trar_no, popularity, erng_sump, erng_sump_asof')
    .eq('race_date', rcDate)
    .eq('meet', meet)
    .eq('rc_no', rcNo)
    .order('pthr_no');

  if (error) throw error;
  if (!entries || entries.length === 0) return [];

  const entryList = entries as EntryRow[];
  const totalHorses = entryList.length;
  const currentMonth = Math.floor((rcDate % 10000) / 100);
  const currentSeason = monthToSeason(currentMonth);
  const allRaceRatings = entryList.map(e => e.ratg ?? 0);

  // 기수·조교사 최근 90일 착순 배치 fetch (⑨b⑩b용)
  const ninetyDaysAgo = dateMinusDays(rcDate, 90);
  const jockeyNos = [...new Set(entryList.map(e => e.jcky_no).filter((x): x is string => x !== null && x !== undefined))];
  const trainerNos = [...new Set(entryList.map(e => e.trar_no).filter((x): x is string => x !== null && x !== undefined))];

  const [jockeyRecentRaw, trainerRecentRaw] = await Promise.all([
    jockeyNos.length > 0
      ? sb.from('race_entries')
          .select('jcky_no, ord')
          .in('jcky_no', jockeyNos)
          .gte('race_date', ninetyDaysAgo)
          .lt('race_date', rcDate)
          .not('ord', 'is', null)
          .lt('ord', 50)
      : Promise.resolve({ data: [] as { jcky_no: string; ord: number }[], error: null }),
    trainerNos.length > 0
      ? sb.from('race_entries')
          .select('trar_no, ord')
          .in('trar_no', trainerNos)
          .gte('race_date', ninetyDaysAgo)
          .lt('race_date', rcDate)
          .not('ord', 'is', null)
          .lt('ord', 50)
      : Promise.resolve({ data: [] as { trar_no: string; ord: number }[], error: null }),
  ]);

  const jockeyRecentMap = new Map<string, number[]>();
  for (const r of (jockeyRecentRaw.data ?? []) as { jcky_no: string; ord: number }[]) {
    if (!jockeyRecentMap.has(r.jcky_no)) jockeyRecentMap.set(r.jcky_no, []);
    jockeyRecentMap.get(r.jcky_no)!.push(r.ord);
  }
  const trainerRecentMap = new Map<string, number[]>();
  for (const r of (trainerRecentRaw.data ?? []) as { trar_no: string; ord: number }[]) {
    if (!trainerRecentMap.has(r.trar_no)) trainerRecentMap.set(r.trar_no, []);
    trainerRecentMap.get(r.trar_no)!.push(r.ord);
  }

  // 경주 거리/주로: race_entries에 없으면 races 테이블에서 fallback
  let rcDist = entryList[0]?.rc_dist ?? null;
  let trackType = entryList[0]?.track_type ?? null;
  if (rcDist === null) {
    const { data: race } = await sb
      .from('races')
      .select('rc_dist, track_type')
      .eq('race_date', rcDate)
      .eq('meet', meet)
      .eq('rc_no', rcNo)
      .maybeSingle();
    rcDist = race?.rc_dist ?? null;
    trackType = race?.track_type ?? null;
  }

  // ⑤⑥⑫⑲⑳ 통계: 누수 방지 as-of(말별 과거 경주만) 사전 패스 — 전역 뷰 미사용
  const distCat = distCategoryOf(rcDist ?? 1600);
  const parMap = await loadParMap(sb); // ⑳ par-time 기준표 (1회 로드)
  const asOfMap = new Map<string, AsOfHorseStats>();
  await Promise.all(
    entryList.map(async (e) => {
      asOfMap.set(e.hr_name, await fetchAsOfHorseStats(sb, e.hr_name, rcDate, distCat, parMap));
    })
  );
  // paceType(⑲)도 as-of position_ratio 기반 → 누수 제거
  const styleMap = new Map<string, { avg: number | null; std: number | null }>();
  for (const e of entryList) {
    const s = asOfMap.get(e.hr_name);
    styleMap.set(e.hr_name, { avg: s?.avgPositionRatio ?? null, std: s?.stddevPositionRatio ?? null });
  }
  const paceType = computePaceType(styleMap);

  const rows = await Promise.all(
    entryList.map(async (e) => {
      const enriched = { ...e, rc_dist: rcDist, track_type: trackType };
      const input = await buildEngineInput(sb, enriched, totalHorses, currentMonth, currentSeason, jockeyRecentMap, trainerRecentMap, styleMap, paceType, asOfMap.get(e.hr_name)!);
      input.erngSump = e.erng_sump ?? undefined;
      input.earningsAsof = e.erng_sump_asof ?? undefined;
      input.allRaceRatings = allRaceRatings;
      return { hr_name: e.hr_name, pthr_no: e.pthr_no, ord: e.ord, input };
    })
  );

  return rows;
}

export async function predictRace(
  sb: SupabaseClient,
  rcDate: number,
  meet: number,
  rcNo: number
): Promise<PredictionRow[]> {
  const rows = await gatherRaceInputs(sb, rcDate, meet, rcNo);
  if (rows.length === 0) return [];

  // 활성 모델 버전으로 스코어링 (rho-legacy=ScoreEngine / logistic=logisticScorer)
  const activeVersion = await getActiveModelVersion(sb);
  const scoreOne = activeVersion.model_type === 'logistic' && activeVersion.artifact
    ? (input: ScoreEngineInput) => scoreLogistic(activeVersion.artifact!, input)
    : (() => { const engine = new ScoreEngine(activeVersion.weights); return (input: ScoreEngineInput) => engine.calculateScores(input); })();

  const results = rows.map((row) => ({ row, score: scoreOne(row.input) }));

  const sorted = [...results].sort((a, b) => b.score.total - a.score.total);
  const rankMap = new Map<number, number>();
  sorted.forEach((r, idx) => rankMap.set(r.row.pthr_no, idx + 1));

  return results.map((r) => ({
    race_date: rcDate,
    meet,
    rc_no: rcNo,
    hr_name: r.row.hr_name,
    total_score: r.score.total,
    predicted_rank: rankMap.get(r.row.pthr_no)!,
    item_scores: r.score.items,
    actual_ord: r.row.ord,
    model_version: activeVersion.id,
  }));
}

async function buildEngineInput(
  sb: SupabaseClient,
  e: EntryRow & { rc_dist: number | null; track_type: string | null },
  totalHorses: number,
  currentMonth: number,
  currentSeason: 'spring' | 'summer' | 'autumn' | 'winter',
  jockeyRecentMap: Map<string, number[]>,
  trainerRecentMap: Map<string, number[]>,
  styleMap: Map<string, { avg: number | null; std: number | null }>,
  paceType: 'HOT' | 'NORMAL' | 'SLOW',
  asOf: AsOfHorseStats
): Promise<ScoreEngineInput> {
  const rcDate = e.race_date;

  // 같은 말의 과거 5경주 (race_entries에서 ord 있는 것만)
  // 구간기록 컬럼 포함: ④ lastFurlong 계산, ⑤ positions 계산용
  const { data: hist5raw } = await sb
    .from('race_entries')
    .select('race_date, meet, rc_no, ord, rc_dist, track_type, wg_hr_diff, burd_wgt, win_odds, popularity, jcky_no, rc_time, se_g1f_acc_time, bu_g1f_acc_time, sj_s1f_ord, bu_s1f_ord, sj_g1f_ord, bu_g1f_ord')
    .eq('hr_name', e.hr_name)
    .lt('race_date', rcDate)
    .not('ord', 'is', null)
    .order('race_date', { ascending: false })
    .limit(5);
  const hist5 = hist5raw ?? [];
  const histAsc = [...hist5].reverse();

  const burdenHistory = await buildBurdenHistory(sb, hist5);

  const sameDistOrds = hist5
    .filter((r) => r.rc_dist === e.rc_dist && r.ord != null)
    .map((r) => r.ord as number);

  // ④ 같은 말의 과거 경주에서 마지막 200m(g1f) 시간 계산
  // meet 1=서울→se_g1f, 3=부경→bu_g1f. 데이터 없으면 0 (알고리즘이 중립 처리).
  const calcLastFurlong = (r: typeof hist5[number]): number => {
    const g1f = r.meet === 1 ? r.se_g1f_acc_time : r.bu_g1f_acc_time;
    return r.rc_time != null && g1f != null ? (r.rc_time as number) - (g1f as number) : 0;
  };

  const sameDistTrackTimes = hist5
    .filter((r) => r.rc_dist === e.rc_dist && r.track_type === e.track_type && r.rc_time != null)
    .map((r) => ({ rcTime: r.rc_time as number, lastFurlong: calcLastFurlong(r) }));
  const sameDistOnlyTimes = hist5
    .filter((r) => r.rc_dist === e.rc_dist && r.rc_time != null)
    .map((r) => ({ rcTime: r.rc_time as number, lastFurlong: calcLastFurlong(r) }));

  // ⑤ 후반 구간 순위 (Step 2 확장):
  //   - startOrd = s1f_ord (초반 200m, 에이스경마 21번 시점)
  //   - g1fOrd = g1f_ord (종반 200m, 3시점 분석)
  //   - fieldSize = 그 경주 출전두수 (ratio 정규화용)
  //
  // hist5의 각 race에 대해 field_size 병렬 조회 (5 queries Promise.all)
  const fieldSizesMap = new Map<string, number>();
  await Promise.all(
    hist5.map(async (r) => {
      const { count } = await sb
        .from('race_entries')
        .select('*', { count: 'exact', head: true })
        .eq('race_date', r.race_date)
        .eq('meet', r.meet)
        .eq('rc_no', r.rc_no);
      fieldSizesMap.set(`${r.race_date}-${r.meet}-${r.rc_no}`, count ?? 0);
    })
  );

  const positions = hist5
    .filter((r) => r.ord != null)
    .map((r) => {
      const startOrd = r.meet === 1 ? r.sj_s1f_ord : r.bu_s1f_ord;
      const g1fOrd = r.meet === 1 ? r.sj_g1f_ord : r.bu_g1f_ord;
      const fieldSize = fieldSizesMap.get(`${r.race_date}-${r.meet}-${r.rc_no}`) ?? 0;
      return {
        startOrd: (startOrd as number) ?? 0,
        finishOrd: r.ord as number,
        fieldSize,
        g1fOrd: (g1fOrd as number) ?? undefined,
        last200mTime: calcLastFurlong(r) || undefined, // 0이면 결측 → undefined
      };
    })
    .filter((p) => p.startOrd > 0 && p.fieldSize >= 2);

  // 통산 선행 성공률 + 거리별 결승 비율 (horse_sectional_ability / horse_running_style_by_distance)
  // + 혈통 DSA 지수 (horses 테이블)
  // ⑤⑥⑫: 누수 방지 as-of 통계를 사전 패스에서 주입받음 (전역 뷰 미사용)
  const frontRunSuccessRate = asOf.frontRunSuccessRate;
  const distFinishRatio: number | null = asOf.distFinishRatio;
  const avgPositionRatio: number | null = asOf.avgPositionRatio;
  const stddevPositionRatio: number | null = asOf.stddevPositionRatio;

  // 혈통 (horses 테이블 — 정적 정보, 누수 아님)
  const { data: pedigreeData } = e.hr_no
    ? await sb
        .from('horses')
        .select('dsa_bri_vl, dsa_clc_vl, dsa_ier_vl, dsa_prf_vl, dsidx_vl')
        .eq('hr_no', e.hr_no)
        .maybeSingle()
    : { data: null };
  const pedigreeRow = pedigreeData as {
    dsa_bri_vl?: number | null;
    dsa_clc_vl?: number | null;
    dsa_ier_vl?: number | null;
    dsa_prf_vl?: number | null;
    dsidx_vl?: number | null;
  } | null;
  const pedigree: ScoreEngineInput['pedigree'] = pedigreeRow
    ? {
        dsaBriVl: pedigreeRow.dsa_bri_vl ?? undefined,
        dsaClcVl: pedigreeRow.dsa_clc_vl ?? undefined,
        dsaIerVl: pedigreeRow.dsa_ier_vl ?? undefined,
        dsaPrfVl: pedigreeRow.dsa_prf_vl ?? undefined,
        dsidxVl: pedigreeRow.dsidx_vl ?? undefined,
      }
    : undefined;

  const overallOrds = hist5.filter((r) => r.ord != null).map((r) => r.ord as number);
  const sameTrackOrds = hist5
    .filter((r) => r.track_type === e.track_type && r.ord != null)
    .map((r) => r.ord as number);

  let jockeyCareerWinRate: number | null = null;
  let jockeyCareerQuRate: number | null = null;
  if (e.jcky_no) {
    const { data: jkStat } = await sb
      .from('jockey_stats')
      .select('win_rate_t, qu_rate_t')
      .eq('jcky_no', e.jcky_no)
      .eq('meet', e.meet)
      .maybeSingle();
    jockeyCareerWinRate = jkStat?.win_rate_t ?? null;
    jockeyCareerQuRate = jkStat?.qu_rate_t ?? null;
  }

  const sixtyDaysAgo = subtractDays(rcDate, 60);
  let trainer60DayOrds: number[] = [];
  if (e.trar_no) {
    const { data: tr } = await sb
      .from('race_entries')
      .select('ord')
      .eq('trar_no', e.trar_no)
      .gte('race_date', sixtyDaysAgo)
      .lt('race_date', rcDate)
      .not('ord', 'is', null);
    trainer60DayOrds = (tr ?? []).map((r) => r.ord as number);
  }

  let intervalDays: number | null = null;
  if (histAsc.length > 0) {
    intervalDays = daysBetween(histAsc[histAsc.length - 1]!.race_date as number, rcDate);
  }

  const { data: seasonRaw } = await sb
    .from('race_entries')
    .select('race_date, ord')
    .eq('hr_name', e.hr_name)
    .lt('race_date', rcDate)
    .not('ord', 'is', null);
  const sameSeasonOrds = (seasonRaw ?? [])
    .filter((r) => monthToSeason(Math.floor((r.race_date % 10000) / 100)) === currentSeason)
    .map((r) => r.ord as number);

  let combinationOrds: number[] = [];
  if (e.jcky_no) {
    const { data: combRaw } = await sb
      .from('race_entries')
      .select('ord')
      .eq('hr_name', e.hr_name)
      .eq('jcky_no', e.jcky_no)
      .lt('race_date', rcDate)
      .not('ord', 'is', null);
    combinationOrds = (combRaw ?? []).map((r) => r.ord as number);
  }
  const horseAllOrds = (seasonRaw ?? []).map((r) => r.ord as number);

  const recent5Popularities = hist5
    .filter((r) => r.popularity != null)
    .map((r) => r.popularity as number);

  return {
    rating: e.ratg ?? 0,
    weightDiffs: histAsc.map((r) => r.wg_hr_diff ?? 0),
    sex: e.gndr ?? undefined,
    currentMonth,
    ord5: histAsc.filter((r) => r.ord != null).map((r) => r.ord as number),
    sameDistTrackTimes,
    sameDistOnlyTimes,
    positions,
    frontRunSuccessRate,
    sameDistOrds,
    distFinishRatio,
    overallOrds,
    sameTrackOrds,
    burdenHistory,
    jockeyCareerWinRate,
    jockeyCareerQuRate,
    trainer60DayOrds,
    intervalDays,
    stOrd: e.pthr_no,
    totalHorses,
    rcDist: e.rc_dist ?? 0,
    avgPositionRatio,
    stddevPositionRatio,
    age: e.ag ?? 0,
    pedigree,
    sameSeasonOrds,
    horseAllOrds,
    combinationOrds,
    recent5Popularities,
    jockeyRecentOrds: e.jcky_no ? (jockeyRecentMap.get(e.jcky_no) ?? []) : [],
    trainerRecentOrds: e.trar_no ? (trainerRecentMap.get(e.trar_no) ?? []) : [],
    runningStyleAvgRatio: styleMap.get(e.hr_name)?.avg ?? null,
    runningStyleStddev: styleMap.get(e.hr_name)?.std ?? null,
    paceType,
    speedFigureAbilityRaw: asOf.speedFigureAbilityRaw,
    careerFinishRatio: asOf.careerFinishRatio,
    careerPlaceRate: asOf.careerPlaceRate,
    careerN: asOf.careerN,
  };
}

type HistRow = {
  race_date: number;
  meet: number;
  rc_no: number;
  ord: number | null;
  burd_wgt: number | null;
};

async function buildBurdenHistory(
  sb: SupabaseClient,
  hist5: HistRow[]
): Promise<Array<{ ord: number; myBudam: number; raceAvgBudam: number }>> {
  if (hist5.length === 0) return [];
  const validHist = hist5.filter((h) => h.ord != null && h.burd_wgt != null);
  if (validHist.length === 0) return [];

  const results: Array<{ ord: number; myBudam: number; raceAvgBudam: number }> = [];
  for (const h of validHist) {
    const { data: peers } = await sb
      .from('race_entries')
      .select('burd_wgt')
      .eq('race_date', h.race_date)
      .eq('meet', h.meet)
      .eq('rc_no', h.rc_no);
    const budams = (peers ?? []).map((p) => p.burd_wgt).filter((v): v is number => v != null);
    if (budams.length === 0) continue;
    const raceAvgBudam = budams.reduce((s, v) => s + v, 0) / budams.length;
    results.push({ ord: h.ord as number, myBudam: h.burd_wgt as number, raceAvgBudam });
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
  return Math.round((rcDateToDate(to).getTime() - rcDateToDate(from).getTime()) / (1000 * 60 * 60 * 24));
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

function computePaceType(
  styleMap: Map<string, { avg: number | null; std: number | null }>
): 'HOT' | 'NORMAL' | 'SLOW' {
  let frontCount = 0;
  for (const { avg, std } of styleMap.values()) {
    if (avg == null) continue;
    const isFree = std != null && std >= 0.35;
    if (!isFree && avg <= 0.35) frontCount++;
  }
  if (frontCount >= 3) return 'HOT';
  if (frontCount <= 1) return 'SLOW';
  return 'NORMAL';
}

function dateMinusDays(dateNum: number, days: number): number {
  const y = Math.floor(dateNum / 10000);
  const m = Math.floor((dateNum % 10000) / 100);
  const d = dateNum % 100;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - days);
  return (
    dt.getFullYear() * 10000 +
    (dt.getMonth() + 1) * 100 +
    dt.getDate()
  );
}
