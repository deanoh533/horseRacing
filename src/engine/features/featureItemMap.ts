/**
 * de-biased 피처명 → 21항목 id 매핑 (buildFeatures 주석 그룹 기준).
 * 로지스틱 기여도(βᵢ·zᵢ)를 항목 단위로 묶어 설명력(item_scores) 유지하기 위함.
 * 매핑 없는 공유맥락 피처는 'context'.
 */
const MAP: Record<string, string> = {
  rating_abs: '01_rating', rating_rel: '01_rating',
  field_rating_mean: '01_rating', field_rating_max: '01_rating', rating_minus_field_mean: '01_rating',
  weight_diff_last: '02_weight_change', weight_diff_slope: '02_weight_change', weight_diff_n: '02_weight_change',
  body_weight: '02_weight_change', body_weight_minus_field_mean: '02_weight_change',
  recent_ord_mean: '03_recent_form', recent_ord_slope: '03_recent_form', recent_ord_std: '03_recent_form', recent_ord_last: '03_recent_form', hist_n: '03_recent_form',
  sectional_total_improve: '04_sectional_time', sectional_last_improve: '04_sectional_time',
  late_finish_ratio_mean: '05_late_position', late_gain_mean: '05_late_position',
  early_pos_s1f_mean: '05_late_position', early_pos_s1f_ratio_mean: '05_late_position',
  late_pos_g1f_mean: '05_late_position', late_pos_g1f_ratio_mean: '05_late_position',
  early_to_finish_gain_mean: '05_late_position', late_200m_speed_mean: '04_sectional_time',
  dist_finish_ratio: '06_distance_fitness', same_dist_n: '06_distance_fitness',
  track_improvement: '07_track_adaptation',
  burden_over_avg: '08_burden_weight', burden_ord_mean: '08_burden_weight',
  jockey_career_qu: '09_jockey_form', jockey_career_win: '09_jockey_form',
  jockey_recent_win: '09b_jockey_recent', jockey_recent_n: '09b_jockey_recent',
  jockey_changed: '09_jockey_form',
  trainer_top3: '10_trainer_form', trainer60_n: '10_trainer_form',
  trainer_recent_top2: '10b_trainer_recent', trainer_recent_n: '10b_trainer_recent',
  interval_days: '11_race_interval',
  interval_b_lt14: '11_race_interval', interval_b_14_20: '11_race_interval', interval_b_21_27: '11_race_interval', interval_b_28_35: '11_race_interval', interval_b_36_45: '11_race_interval', interval_b_46_60: '11_race_interval', interval_b_61_90: '11_race_interval', interval_b_90p: '11_race_interval',
  gate_relative: '12_starting_position',
  age: '13_age_distance_gender', x_young_short: '13_age_distance_gender', x_old_long: '13_age_distance_gender', sex_mare: '13_age_distance_gender', sex_gelding: '13_age_distance_gender',
  pedigree_dsa_mean: '14_pedigree',
  season_top3: '15_seasonal_pattern', season_n: '15_seasonal_pattern',
  chemistry_improvement: '16_jockey_horse_chemistry', combo_n: '16_jockey_horse_chemistry',
  recent_pop_top2: '17_market_odds',
  career_finish_ratio: '18_earnings', career_place_rate: '18_earnings', career_n: '18_earnings', earnings_asof_log: '18_earnings',
  style_avg_ratio: '19_running_style_pace', style_stddev: '19_running_style_pace', pace_hot: '19_running_style_pace', pace_slow: '19_running_style_pace',
  speed_ability_raw: '20_speed_figure',
};
for (const s of ['front', 'pace', 'stalker', 'closer'])
  for (const p of ['hot', 'normal', 'slow'])
    MAP[`x_${s}_${p}`] = '19_running_style_pace';

/** 피처명 → 항목id. `__missing` 접미사는 본체와 같은 항목. 미매핑은 'context'. */
export function featureToItem(feature: string): string {
  const base = feature.endsWith('__missing') ? feature.slice(0, -'__missing'.length) : feature;
  return MAP[base] ?? 'context';
}
