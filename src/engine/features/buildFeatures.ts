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

  // ② 마체중 변화 (raw; U자 비단조 버킷은 계획 B)
  const wd = input.weightDiffs ?? [];
  if (wd.length > 0) {
    add('weight_diff_last', wd[wd.length - 1]!);   // 최근 변화량(kg), oldest→recent
    add('weight_diff_slope', slope(wd));           // 추세 기울기
  }
  add('weight_diff_n', (input.weightDiffs ?? []).length);

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

    // 신규 raw 구간 후보 (해석·점수화 없이 평균만; 상관·holdout으로 채택 결정)
    // ① 초반 200m(s1f) 순위 — raw 등수 + 출주두수 비율
    add('early_pos_s1f_mean', mean(positions.map((p) => p.startOrd)));
    add('early_pos_s1f_ratio_mean', mean(positions.map((p) => (p.startOrd - 1) / Math.max(1, p.fieldSize - 1))));
    // ④ 초반−최종 등수 상승폭 (raw, ③ late_gain_mean의 비가공 버전)
    add('early_to_finish_gain_mean', mean(positions.map((p) => p.startOrd - p.finishOrd)));
    // ② 종반 200m(g1f) 순위 — raw 등수 + 비율 (결측 제외)
    const withG1f = positions.filter((p) => p.g1fOrd != null && p.g1fOrd > 0);
    if (withG1f.length > 0) {
      add('late_pos_g1f_mean', mean(withG1f.map((p) => p.g1fOrd!)));
      add('late_pos_g1f_ratio_mean', mean(withG1f.map((p) => (p.g1fOrd! - 1) / Math.max(1, p.fieldSize - 1))));
    }
    // ③ 종반 200m 속도 = 200m ÷ 마지막 200m 시간 (m/s, 거리 무관 물리량; 결측 제외)
    const withSpd = positions.filter((p) => p.last200mTime != null && p.last200mTime > 0);
    if (withSpd.length > 0) {
      add('late_200m_speed_mean', mean(withSpd.map((p) => 200 / p.last200mTime!)));
    }
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

  // ⑱ 통산 클래스 신호 (earnings 누수 대체 — as-of 과거 ord 이력)
  if (input.careerFinishRatio != null) add('career_finish_ratio', input.careerFinishRatio);
  if (input.careerPlaceRate != null) add('career_place_rate', input.careerPlaceRate);
  add('career_n', input.careerN ?? 0);
  if (input.earningsAsof != null) add('earnings_asof_log', Math.log1p(input.earningsAsof));

  // ⑲ 주행성향 raw (페이스 교차는 계획 B)
  if (input.runningStyleAvgRatio != null) add('style_avg_ratio', input.runningStyleAvgRatio);
  if (input.runningStyleStddev != null) add('style_stddev', input.runningStyleStddev);

  // ⑳ 속도능력지수 raw
  if (input.speedFigureAbilityRaw != null) add('speed_ability_raw', input.speedFigureAbilityRaw);

  // ⑪ 경주간격 버킷 (실측 ∩자: 정점 28-35일)
  if (input.intervalDays != null) {
    const dd = input.intervalDays;
    const inB = (lo: number, hi: number) => (dd >= lo && dd < hi ? 1 : 0);
    add('interval_b_lt14', dd < 14 ? 1 : 0);
    add('interval_b_14_20', inB(14, 21));
    add('interval_b_21_27', inB(21, 28));
    add('interval_b_28_35', inB(28, 36));
    add('interval_b_36_45', inB(36, 46));
    add('interval_b_46_60', inB(46, 61));
    add('interval_b_61_90', inB(61, 91));
    add('interval_b_90p', dd >= 91 ? 1 : 0);
  }

  // ⑲ 주행성향 × 페이스 교차 (SCORE_MAP 대체 — 모델이 맵을 학습)
  const xAvg = input.runningStyleAvgRatio;
  const xFree = input.runningStyleStddev != null && input.runningStyleStddev >= 0.35;
  const xStyle = xAvg == null ? 'unknown'
    : xFree ? 'free'
    : xAvg <= 0.15 ? 'front'
    : xAvg <= 0.35 ? 'pace'
    : xAvg <= 0.65 ? 'stalker' : 'closer';
  const xPace = input.paceType ?? 'NORMAL';
  for (const s of ['front', 'pace', 'stalker', 'closer'] as const) {
    for (const p of ['HOT', 'NORMAL', 'SLOW'] as const) {
      add(`x_${s}_${p.toLowerCase()}`, xStyle === s && xPace === p ? 1 : 0);
    }
  }

  // ⑬ 나이 × 거리 교차 (AGE_DIST_MATRIX 대체)
  if (input.age != null && input.rcDist != null) {
    const young = input.age <= 4 ? 1 : 0;
    const old = input.age >= 6 ? 1 : 0;
    const short = input.rcDist <= 1300 ? 1 : 0;
    const long = input.rcDist >= 1800 ? 1 : 0;
    add('x_young_short', young && short ? 1 : 0);
    add('x_old_long', old && long ? 1 : 0);
  }

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
  missingFlag('career_finish_ratio', input.careerFinishRatio != null);
  missingFlag('career_place_rate', input.careerPlaceRate != null);
  missingFlag('earnings_asof_log', input.earningsAsof != null);
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
