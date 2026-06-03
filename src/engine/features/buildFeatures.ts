/**
 * de-biased feature 빌더.
 * 항목의 raw 측정값만 추출 — ⓑ 가치판단(임계값·맵·multiplier·정규화)을 거치지 않는다.
 * 좋고나쁨 판단은 모델이 학습한다. win_odds는 의도적으로 제외.
 */
import type { ScoreEngineInput } from '../index.js';
import type { Feature, FeatureVector } from './types.js';

function slope(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i + 1, y = arr[i] ?? 0;
    sx += x; sy += y; sxy += x * y; sx2 += x * x;
  }
  const den = n * sx2 - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}
function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

export function buildFeatures(input: ScoreEngineInput): FeatureVector {
  const f: Feature[] = [];
  const add = (name: string, value: number) => f.push({ name, value });

  // ① 레이팅
  add('rating_abs', input.rating ?? 0);
  if (input.allRaceRatings && input.allRaceRatings.length >= 2 && (input.rating ?? 0) > 0) {
    const rated = input.allRaceRatings.filter((r) => r > 0);
    // 01_rating.ts와 동일 의미(동점 포함): 1 - (나보다 높은 비율)
    const better = rated.filter((r) => r > input.rating).length;
    add('rating_rel', rated.length > 1 ? 1 - better / (rated.length - 1) : 0.5);
  }

  // ③ 착순 추세 (ord5: 과거→최근)
  const ord5 = input.ord5 ?? [];
  if (ord5.length > 0) {
    add('recent_ord_mean', mean(ord5));
    add('recent_ord_slope', slope(ord5));
    add('recent_ord_std', std(ord5));
    add('recent_ord_last', ord5[ord5.length - 1]!);
  }

  // ④ 구간시간 단축 (raw 초)
  const times = (input.sameDistTrackTimes && input.sameDistTrackTimes.length >= 2)
    ? input.sameDistTrackTimes
    : (input.sameDistOnlyTimes ?? []);
  if (times.length >= 2) {
    const recentTotal = times[0]!.rcTime;
    const pastTotal = mean(times.slice(1).map((t) => t.rcTime));
    add('sectional_total_improve', pastTotal - recentTotal);
    const recentLast = times[0]!.lastFurlong;
    const pastLast = mean(times.slice(1).map((t) => t.lastFurlong));
    add('sectional_last_improve', pastLast - recentLast);
  }

  // ⑤ 후반 구간: 결승 ratio·gain raw
  const positions = input.positions ?? [];
  if (positions.length > 0) {
    const finishRatios = positions.map((p) => (p.finishOrd - 1) / Math.max(1, p.fieldSize - 1));
    const gains = positions.map((p) => {
      const sr = (p.startOrd - 1) / Math.max(1, p.fieldSize - 1);
      const fr = (p.finishOrd - 1) / Math.max(1, p.fieldSize - 1);
      return sr - fr;
    });
    add('late_finish_ratio_mean', mean(finishRatios));
    add('late_gain_mean', mean(gains));
  }

  // ⑥ 거리 적성
  if (input.distFinishRatio != null) add('dist_finish_ratio', input.distFinishRatio);

  // ⑦ 주로 적응 (raw 향상도)
  const overall = input.overallOrds ?? [];
  const sameTrack = input.sameTrackOrds ?? [];
  if (overall.length >= 1 && sameTrack.length >= 1) {
    add('track_improvement', mean(overall) - mean(sameTrack));
  }

  // ⑧ 부담중량 (raw, α 제거)
  const bh = input.burdenHistory ?? [];
  if (bh.length > 0) {
    add('burden_over_avg', mean(bh.map((h) => h.myBudam - h.raceAvgBudam)));
    add('burden_ord_mean', mean(bh.map((h) => h.ord)));
  }

  // ⑨ 기수 통산
  if (input.jockeyCareerQuRate != null) add('jockey_career_qu', input.jockeyCareerQuRate / 100);
  if (input.jockeyCareerWinRate != null) add('jockey_career_win', input.jockeyCareerWinRate / 100);

  // ⑨b 기수 최근 90일 단승률
  const jr = input.jockeyRecentOrds ?? [];
  if (jr.length > 0) add('jockey_recent_win', jr.filter((o) => o === 1).length / jr.length);

  // ⑩ 조교사 60일 top3율
  const tr60 = input.trainer60DayOrds ?? [];
  if (tr60.length > 0) add('trainer_top3', tr60.filter((o) => o <= 3).length / tr60.length);

  // ⑩b 조교사 최근 90일 top2율
  const trr = input.trainerRecentOrds ?? [];
  if (trr.length > 0) add('trainer_recent_top2', trr.filter((o) => o <= 2).length / trr.length);

  // ⑪ 경주 간격 (raw, 버킷은 계획 B)
  if (input.intervalDays != null) add('interval_days', input.intervalDays);

  // ⑫ 출발번호 상대위치 (raw, ⓑ multiplier 제거)
  if (input.stOrd != null && input.totalHorses != null && input.totalHorses > 1) {
    add('gate_relative', (input.totalHorses - input.stOrd) / (input.totalHorses - 1));
  }
  if (input.rcDist != null) add('rc_dist', input.rcDist);

  // ⑬ 나이
  if (input.age != null) add('age', input.age);

  // ⑭ 혈통 (raw 평균)
  const ped = input.pedigree ?? {};
  const dsa = [ped.dsaBriVl, ped.dsaClcVl, ped.dsaIerVl, ped.dsaPrfVl, ped.dsidxVl]
    .filter((v): v is number => typeof v === 'number' && v > 0);
  if (dsa.length > 0) add('pedigree_dsa_mean', mean(dsa));

  // ⑮ 계절 top3율
  const ss = input.sameSeasonOrds ?? [];
  if (ss.length > 0) add('season_top3', ss.filter((o) => o <= 3).length / ss.length);

  // ⑯ 궁합 (raw 향상도)
  const ha = input.horseAllOrds ?? [];
  const co = input.combinationOrds ?? [];
  if (ha.length >= 1 && co.length >= 1) add('chemistry_improvement', mean(ha) - mean(co));

  // ⑰ 과거 인기 proxy (오늘 odds 아님)
  const pop = input.recent5Popularities ?? [];
  if (pop.length > 0) add('recent_pop_top2', pop.filter((p) => p <= 2).length / pop.length);

  // ⑱ 수득상금 log
  if (input.erngSump != null) add('earnings_log', Math.log1p(input.erngSump));

  // ⑲ 주행성향 raw (페이스 교차는 계획 B)
  if (input.runningStyleAvgRatio != null) add('style_avg_ratio', input.runningStyleAvgRatio);
  if (input.runningStyleStddev != null) add('style_stddev', input.runningStyleStddev);

  // ⑳ 속도능력지수 raw
  if (input.speedFigureAbilityRaw != null) add('speed_ability_raw', input.speedFigureAbilityRaw);

  // --- 표본수 (작은표본 할인용) ---
  add('jockey_recent_n', (input.jockeyRecentOrds ?? []).length);
  add('trainer_recent_n', (input.trainerRecentOrds ?? []).length);
  add('trainer60_n', (input.trainer60DayOrds ?? []).length);
  add('same_dist_n', (input.sameDistOrds ?? []).length);
  add('season_n', (input.sameSeasonOrds ?? []).length);
  add('combo_n', (input.combinationOrds ?? []).length);
  add('hist_n', (input.ord5 ?? []).length);

  // --- 결측표시 (value=0 + __missing=1). 값이 있을 때는 위에서 이미 push됨. ---
  const missingFlag = (name: string, present: boolean) => {
    add(`${name}__missing`, present ? 0 : 1);
    if (!present) add(name, 0);
  };
  missingFlag('dist_finish_ratio', input.distFinishRatio != null);
  missingFlag('speed_ability_raw', input.speedFigureAbilityRaw != null);
  missingFlag('pedigree_dsa_mean', dsa.length > 0);
  missingFlag('style_avg_ratio', input.runningStyleAvgRatio != null);
  missingFlag('style_stddev', input.runningStyleStddev != null);

  // --- 카테고리 one-hot ---
  add('sex_mare', input.sex === '암' ? 1 : 0);
  add('sex_gelding', input.sex === '거' ? 1 : 0);
  add('pace_hot', input.paceType === 'HOT' ? 1 : 0);
  add('pace_slow', input.paceType === 'SLOW' ? 1 : 0);

  return f;
}
