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
});
