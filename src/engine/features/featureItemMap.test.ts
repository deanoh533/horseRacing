import { describe, it, expect } from 'vitest';
import { featureToItem } from './featureItemMap.js';

describe('featureToItem', () => {
  it('항목별 대표 피처 매핑', () => {
    expect(featureToItem('rating_abs')).toBe('01_rating');
    expect(featureToItem('rating_rel')).toBe('01_rating');
    expect(featureToItem('burden_over_avg')).toBe('08_burden_weight');
    expect(featureToItem('interval_b_28_35')).toBe('11_race_interval');
    expect(featureToItem('x_front_hot')).toBe('19_running_style_pace');
    expect(featureToItem('speed_ability_raw')).toBe('20_speed_figure');
    expect(featureToItem('jockey_recent_win')).toBe('09b_jockey_recent');
  });
  it('결측·표본수 접미사도 같은 항목으로', () => {
    expect(featureToItem('dist_finish_ratio__missing')).toBe('06_distance_fitness');
    expect(featureToItem('same_dist_n')).toBe('06_distance_fitness');
    expect(featureToItem('style_stddev__missing')).toBe('19_running_style_pace');
  });
  it('매핑 없는 공유맥락은 context', () => {
    expect(featureToItem('rc_dist')).toBe('context');
    expect(featureToItem('완전모르는피처')).toBe('context');
  });
  it('통산 클래스 신호는 ⑱로 매핑 (earnings 대체)', () => {
    expect(featureToItem('career_finish_ratio')).toBe('18_earnings');
    expect(featureToItem('career_place_rate')).toBe('18_earnings');
    expect(featureToItem('career_n')).toBe('18_earnings');
    expect(featureToItem('career_finish_ratio__missing')).toBe('18_earnings');
  });
  it('진짜 as-of 수득상금도 ⑱로 매핑', () => {
    expect(featureToItem('earnings_asof_log')).toBe('18_earnings');
    expect(featureToItem('earnings_asof_log__missing')).toBe('18_earnings');
  });
  it('제거된 earnings_log는 미매핑(context)', () => {
    expect(featureToItem('earnings_log')).toBe('context');
  });
  it('신규 raw 신호군은 고유 그룹(게이트B ablation 대상)', () => {
    expect(featureToItem('med_bled_asof')).toBe('med_bleed');
    expect(featureToItem('med_bled_days_since')).toBe('med_bleed');
    expect(featureToItem('med_fatigue_asof')).toBe('med_fatigue');
    expect(featureToItem('med_fatigue_days_since')).toBe('med_fatigue');
    expect(featureToItem('train_has_data')).toBe('train_signal');
    expect(featureToItem('train_jockey_ridden_ratio')).toBe('train_signal');
    // 기존 trainer_* 와 충돌 없음
    expect(featureToItem('trainer_top3')).toBe('10_trainer_form');
    expect(featureToItem('trainer_recent_n')).toBe('10b_trainer_recent');
  });
  it('pace_fit·pace_sens 계열은 pace_form 그룹', () => {
    expect(featureToItem('pace_fit')).toBe('pace_form');
    expect(featureToItem('pace_fit_n')).toBe('pace_form');
    expect(featureToItem('pace_fit__missing')).toBe('pace_form');
    expect(featureToItem('pace_sens')).toBe('pace_form');
    expect(featureToItem('pace_hot')).not.toBe('pace_form'); // 기존 경주단위 one-hot과 분리
  });
});
