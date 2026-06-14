/**
 * Score Predictor
 * - 한 경주의 출전마 전체에 대해 Score Engine 입력을 준비하고 호출
 * - race_entries 테이블에서 사전/사후 자동 분기
 *   - ord가 null  → 사전 모드 (출주표 기반 예측)
 *   - ord가 있음  → 사후 모드 (결과 포함 백테스트)
 */
import type { ReadClient } from '../db/localDb.js';
import { ScoreEngine, type HorseScoreResult, type ScoreEngineInput, type TrainingSession } from './index.js';
import { getActiveModelVersion } from './modelVersion.js';
import { scoreLogistic } from './logisticScorer.js';
import { parseClassBand } from './features/intentSignals.js';
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
  wg_hr: number | null;
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
  sb: ReadClient,
  rcDate: number,
  meet: number,
  rcNo: number
): Promise<RaceInputRow[]> {
  // race_entries에서 조회 (사전/사후 자동 분기)
  const { data: entries, error } = await sb
    .from('race_entries')
    .select('race_date, meet, rc_no, pthr_no, hr_name, hr_no, ag, gndr, ratg, ord, rc_dist, track_type, burd_wgt, wg_hr, jcky_no, trar_no, popularity, erng_sump, erng_sump_asof')
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
  const allRaceBodyWeights = entryList.map(e => e.wg_hr ?? 0);

  // 기수·조교사 최근 90일 착순 배치 fetch (⑨b⑩b용)
  // ⚠️ 페이지네이션 필수: 한 경주 기수×90일이 1000행(Supabase 기본 캡)을 넘으면
  //    .range() 없이는 1000행만, .order() 없이는 *비결정적으로* 잘려 패리티가 깨진다.
  const ninetyDaysAgo = dateMinusDays(rcDate, 90);
  const jockeyNos = [...new Set(entryList.map(e => e.jcky_no).filter((x): x is string => x !== null && x !== undefined))];
  const trainerNos = [...new Set(entryList.map(e => e.trar_no).filter((x): x is string => x !== null && x !== undefined))];

  const fetchRecentOrds = async (col: 'jcky_no' | 'trar_no', nos: string[]): Promise<Map<string, number[]>> => {
    const map = new Map<string, number[]>();
    if (nos.length === 0) return map;
    const PAGE = 1000;
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await sb.from('race_entries')
        .select(`${col}, ord`)
        .in(col, nos)
        .gte('race_date', ninetyDaysAgo)
        .lt('race_date', rcDate)
        .not('ord', 'is', null)
        .lt('ord', 50)
        .order('race_date').order('meet').order('rc_no').order(col) // 안정 정렬(결정적 페이지 경계)
        .range(off, off + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data as Array<Record<string, string | number>>) {
        const key = r[col] as string;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(r.ord as number);
      }
      if (data.length < PAGE) break;
    }
    return map;
  };

  const [jockeyRecentMap, trainerRecentMap] = await Promise.all([
    fetchRecentOrds('jcky_no', jockeyNos),
    fetchRecentOrds('trar_no', trainerNos),
  ]);

  // 경주 거리/주로/등급: race_entries에 거리 없으면 races fallback. prize_cond는 races 전용.
  let rcDist = entryList[0]?.rc_dist ?? null;
  let trackType = entryList[0]?.track_type ?? null;
  let prizeCond: string | null = null;
  {
    const { data: race } = await sb
      .from('races')
      .select('rc_dist, track_type, prize_cond')
      .eq('race_date', rcDate)
      .eq('meet', meet)
      .eq('rc_no', rcNo)
      .maybeSingle();
    if (rcDist === null) { rcDist = race?.rc_dist ?? null; trackType = race?.track_type ?? null; }
    prizeCond = race?.prize_cond ?? null;
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

  // ── 말별 쿼리 배치화 (경주당 ~150 라운드트립 → ~7). buildEngineInput은 이 맵만 읽음(쿼리 0). ──
  const hrNamesU = [...new Set(entryList.map((e) => e.hr_name))];
  const hrNosU = [...new Set(entryList.map((e) => e.hr_no).filter((x): x is string => x != null))];

  // (A) 전 출주마 과거 경주 전체 → hist5·시즌·조합·직전등급 파생 (한 말 같은날 중복출주 없음 → top5 안정)
  const histByHorse = new Map<string, HistFull[]>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('race_entries')
      .select('hr_name, race_date, meet, rc_no, ord, rc_dist, track_type, wg_hr_diff, burd_wgt, win_odds, popularity, jcky_no, rc_time, se_g1f_acc_time, bu_g1f_acc_time, sj_s1f_ord, bu_s1f_ord, sj_g1f_ord, bu_g1f_ord')
      .in('hr_name', hrNamesU).lt('race_date', rcDate).not('ord', 'is', null)
      .order('hr_name').order('race_date', { ascending: false }).order('meet').order('rc_no')
      .range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as HistFull[]) { const a = histByHorse.get(r.hr_name); if (a) a.push(r); else histByHorse.set(r.hr_name, [r]); }
    if (data.length < 1000) break;
  }

  // (B) hist5 경주들의 엔트리 burd_wgt → fieldSize(count)·burden(avg) 공용 (날짜 in 후 키 그룹)
  const histDates = new Set<number>();
  for (const [, h] of histByHorse) for (const r of h.slice(0, 5)) histDates.add(r.race_date);
  const histRaceBudams = new Map<string, (number | null)[]>();
  if (histDates.size > 0) {
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.from('race_entries')
        .select('race_date, meet, rc_no, burd_wgt')
        .in('race_date', [...histDates])
        .order('race_date').order('meet').order('rc_no')
        .range(off, off + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data as { race_date: number; meet: number; rc_no: number; burd_wgt: number | null }[]) {
        const k = `${r.race_date}-${r.meet}-${r.rc_no}`; const a = histRaceBudams.get(k); if (a) a.push(r.burd_wgt); else histRaceBudams.set(k, [r.burd_wgt]);
      }
      if (data.length < 1000) break;
    }
  }

  // (C) 혈통 (D) 기수통산 (E) 조교사60일 (F) 직전경주 등급 — .in() 배치
  const pedigreeMap = new Map<string, Record<string, number | null>>();
  const jockeyCareerMap = new Map<string, { win_rate_t: number | null; qu_rate_t: number | null }>();
  const trainer60Map = new Map<string, number[]>();
  const racePrizeCondMap = new Map<string, string | null>();
  const sixtyAgo = subtractDays(rcDate, 60);
  const lastDates = new Set<number>();
  for (const [, h] of histByHorse) if (h[0]) lastDates.add(h[0].race_date);
  await Promise.all([
    (async () => { if (hrNosU.length === 0) return; const { data } = await sb.from('horses').select('hr_no, dsa_bri_vl, dsa_clc_vl, dsa_ier_vl, dsa_prf_vl, dsidx_vl').in('hr_no', hrNosU); for (const r of (data ?? []) as Record<string, number | null>[]) pedigreeMap.set(r.hr_no as unknown as string, r); })(),
    (async () => { if (jockeyNos.length === 0) return; const { data } = await sb.from('jockey_stats').select('jcky_no, win_rate_t, qu_rate_t').in('jcky_no', jockeyNos).eq('meet', meet); for (const r of (data ?? []) as { jcky_no: string; win_rate_t: number | null; qu_rate_t: number | null }[]) jockeyCareerMap.set(r.jcky_no, { win_rate_t: r.win_rate_t, qu_rate_t: r.qu_rate_t }); })(),
    (async () => { if (trainerNos.length === 0) return; for (let off = 0; ; off += 1000) { const { data, error } = await sb.from('race_entries').select('trar_no, ord').in('trar_no', trainerNos).gte('race_date', sixtyAgo).lt('race_date', rcDate).not('ord', 'is', null).order('race_date').order('meet').order('rc_no').order('trar_no').range(off, off + 999); if (error) throw error; if (!data || data.length === 0) break; for (const r of data as { trar_no: string; ord: number }[]) { const a = trainer60Map.get(r.trar_no); if (a) a.push(r.ord); else trainer60Map.set(r.trar_no, [r.ord]); } if (data.length < 1000) break; } })(),
    (async () => { if (lastDates.size === 0) return; const { data } = await sb.from('races').select('race_date, meet, rc_no, prize_cond').in('race_date', [...lastDates]); for (const r of (data ?? []) as { race_date: number; meet: number; rc_no: number; prize_cond: string | null }[]) racePrizeCondMap.set(`${r.race_date}-${r.meet}-${r.rc_no}`, r.prize_cond ?? null); })(),
  ]);
  // (G) 조교이력 as-of: hr_no별 train_date<rcDate (최근 365일 캡). 누수 0.
  const trainingByHorse = new Map<string, TrainingSession[]>();
  if (hrNosU.length > 0) {
    const trainFloor = subtractDays(rcDate, 365);
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.from('training_logs')
        .select('hr_no, train_date, tr_term, run1_cnt, run2_cnt, pr_gubun')
        .in('hr_no', hrNosU)
        .gte('train_date', trainFloor)
        .lt('train_date', rcDate)
        .order('hr_no').order('train_date', { ascending: false })
        .range(off, off + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ hr_no: string; train_date: number; tr_term: number | null; run1_cnt: number | null; run2_cnt: number | null; pr_gubun: string | null }>) {
        const s: TrainingSession = { trainDate: r.train_date, trTerm: r.tr_term, run1Cnt: r.run1_cnt, run2Cnt: r.run2_cnt, prGubun: r.pr_gubun };
        const a = trainingByHorse.get(r.hr_no); if (a) a.push(s); else trainingByHorse.set(r.hr_no, [s]);
      }
      if (data.length < 1000) break;
    }
  }

  const batch: RaceBatch = { histByHorse, histRaceBudams, pedigreeMap, jockeyCareerMap, trainer60Map, racePrizeCondMap, trainingByHorse };

  const rows = await Promise.all(
    entryList.map(async (e) => {
      const enriched = { ...e, rc_dist: rcDist, track_type: trackType, prize_cond: prizeCond };
      const input = buildEngineInput(enriched, totalHorses, currentMonth, currentSeason, jockeyRecentMap, trainerRecentMap, styleMap, paceType, asOfMap.get(e.hr_name)!, batch);
      input.erngSump = e.erng_sump ?? undefined;
      input.earningsAsof = e.erng_sump_asof ?? undefined;
      input.allRaceRatings = allRaceRatings;
      input.bodyWeight = e.wg_hr ?? undefined;
      input.allRaceBodyWeights = allRaceBodyWeights;
      input.raceDate = e.race_date;
      input.prevRaceDate = batch.histByHorse.get(e.hr_name)?.[0]?.race_date ?? null;
      input.trainingHistory = e.hr_no ? (batch.trainingByHorse.get(e.hr_no) ?? []) : [];
      return { hr_name: e.hr_name, pthr_no: e.pthr_no, ord: e.ord, input };
    })
  );

  return rows;
}

export async function predictRace(
  sb: ReadClient,
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

type HistFull = {
  hr_name: string; race_date: number; meet: number; rc_no: number;
  ord: number | null; rc_dist: number | null; track_type: string | null;
  wg_hr_diff: number | null; burd_wgt: number | null; win_odds: number | null;
  popularity: number | null; jcky_no: string | null; rc_time: number | null;
  se_g1f_acc_time: number | null; bu_g1f_acc_time: number | null;
  sj_s1f_ord: number | null; bu_s1f_ord: number | null; sj_g1f_ord: number | null; bu_g1f_ord: number | null;
};
interface RaceBatch {
  histByHorse: Map<string, HistFull[]>;
  histRaceBudams: Map<string, (number | null)[]>;
  pedigreeMap: Map<string, Record<string, number | null>>;
  jockeyCareerMap: Map<string, { win_rate_t: number | null; qu_rate_t: number | null }>;
  trainer60Map: Map<string, number[]>;
  racePrizeCondMap: Map<string, string | null>;
  trainingByHorse: Map<string, TrainingSession[]>; // key: hr_no
}

function buildEngineInput(
  e: EntryRow & { rc_dist: number | null; track_type: string | null; prize_cond: string | null },
  totalHorses: number,
  currentMonth: number,
  currentSeason: 'spring' | 'summer' | 'autumn' | 'winter',
  jockeyRecentMap: Map<string, number[]>,
  trainerRecentMap: Map<string, number[]>,
  styleMap: Map<string, { avg: number | null; std: number | null }>,
  paceType: 'HOT' | 'NORMAL' | 'SLOW',
  asOf: AsOfHorseStats,
  batch: RaceBatch
): ScoreEngineInput {
  const rcDate = e.race_date;

  // 같은 말의 과거 경주 (배치 (A)에서 주입). hist5=최근 5, fullHist=전체(시즌·조합용).
  const fullHist = batch.histByHorse.get(e.hr_name) ?? [];
  const hist5 = fullHist.slice(0, 5);
  const histAsc = [...hist5].reverse();

  const burdenHistory = buildBurdenHistory(hist5, batch.histRaceBudams);

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
  // field_size = 그 경주 전체 출주두수 (배치 (B): histRaceBudams 행수)
  const fieldSizesMap = new Map<string, number>();
  for (const r of hist5) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    fieldSizesMap.set(k, batch.histRaceBudams.get(k)?.length ?? 0);
  }

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

  // 혈통 (배치 (C): horses — 정적 정보, 누수 아님)
  const pedigreeRow = (e.hr_no ? batch.pedigreeMap.get(e.hr_no) : undefined) ?? null;
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

  const jk = e.jcky_no ? batch.jockeyCareerMap.get(e.jcky_no) : undefined;
  const jockeyCareerWinRate: number | null = jk?.win_rate_t ?? null;
  const jockeyCareerQuRate: number | null = jk?.qu_rate_t ?? null;

  // 조교사 60일 착순 (배치 (E))
  const trainer60DayOrds: number[] = e.trar_no ? (batch.trainer60Map.get(e.trar_no) ?? []) : [];

  let intervalDays: number | null = null;
  if (histAsc.length > 0) {
    intervalDays = daysBetween(histAsc[histAsc.length - 1]!.race_date as number, rcDate);
  }

  // 시즌·조합·전체착순: 배치 (A) fullHist 파생 (집계라 순서 무관)
  const sameSeasonOrds = fullHist
    .filter((r) => monthToSeason(Math.floor((r.race_date % 10000) / 100)) === currentSeason)
    .map((r) => r.ord as number);
  const combinationOrds: number[] = e.jcky_no
    ? fullHist.filter((r) => r.jcky_no === e.jcky_no).map((r) => r.ord as number)
    : [];
  const horseAllOrds = fullHist.map((r) => r.ord as number);

  const recent5Popularities = hist5
    .filter((r) => r.popularity != null)
    .map((r) => r.popularity as number);

  // 등급 이동: 직전 경주(hist5[0]=가장 최근 과거) 밴드 vs 오늘 (races.prize_cond)
  const last = hist5[0];
  const classBandToday = parseClassBand(e.prize_cond);
  let classBandLast: number | null = null;
  if (last) {
    const pc = batch.racePrizeCondMap.get(`${last.race_date}-${last.meet}-${last.rc_no}`) ?? null;
    classBandLast = parseClassBand(pc);
  }

  return {
    rating: e.ratg ?? 0,
    weightDiffs: histAsc.map((r) => r.wg_hr_diff ?? 0),
    sex: e.gndr ?? undefined,
    currentMonth,
    classBandToday,
    classBandLast,
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

function buildBurdenHistory(
  hist5: HistRow[],
  histRaceBudams: Map<string, (number | null)[]>
): Array<{ ord: number; myBudam: number; raceAvgBudam: number }> {
  if (hist5.length === 0) return [];
  const validHist = hist5.filter((h) => h.ord != null && h.burd_wgt != null);
  if (validHist.length === 0) return [];

  const results: Array<{ ord: number; myBudam: number; raceAvgBudam: number }> = [];
  for (const h of validHist) {
    const budams = (histRaceBudams.get(`${h.race_date}-${h.meet}-${h.rc_no}`) ?? []).filter((v): v is number => v != null);
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
