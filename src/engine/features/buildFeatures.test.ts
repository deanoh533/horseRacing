import { describe, it, expect } from 'vitest';
import { buildFeatures } from './buildFeatures.js';
import type { ScoreEngineInput } from '../index.js';

const base: ScoreEngineInput = { rating: 0 };

function val(input: ScoreEngineInput, name: string): number | undefined {
  return buildFeatures(input).find((f) => f.name === name)?.value;
}

describe('buildFeatures — 연속형 raw', () => {
  it('① 절대 레이팅을 raw로 낸다', () => {
    expect(val({ rating: 88 }, 'rating_abs')).toBe(88);
  });
  it('① 경주내 상대순위(0~1): 더 높은 레이팅이 더 큰 값', () => {
    const v = val({ rating: 90, allRaceRatings: [70, 80, 90] }, 'rating_rel');
    expect(v).toBeCloseTo(1.0, 5);
  });
  it('③ 최근 착순 평균과 기울기 (ord5는 과거→최근)', () => {
    const input = { ...base, ord5: [5, 4, 3, 2, 1] };
    expect(val(input, 'recent_ord_mean')).toBeCloseTo(3, 5);
    expect(val(input, 'recent_ord_slope')).toBeLessThan(0);
    expect(val(input, 'recent_ord_last')).toBe(1);
  });
  it('⑥ 거리 결승비율 raw를 그대로 통과', () => {
    expect(val({ ...base, distFinishRatio: 0.2 }, 'dist_finish_ratio')).toBe(0.2);
  });
  it('⑧ 부담중량: 평균 (내부담−경주평균)과 평균 착순을 따로 낸다', () => {
    const input: ScoreEngineInput = {
      ...base,
      burdenHistory: [
        { ord: 3, myBudam: 57, raceAvgBudam: 54 },
        { ord: 1, myBudam: 55, raceAvgBudam: 54 },
      ],
    };
    expect(val(input, 'burden_over_avg')).toBeCloseTo(2, 5);
    expect(val(input, 'burden_ord_mean')).toBeCloseTo(2, 5);
  });
  it('⑱ 수득상금은 log1p로', () => {
    const v = val({ ...base, erngSump: 100_000_000 }, 'earnings_log');
    expect(v).toBeCloseTo(Math.log1p(100_000_000), 5);
  });
  it('⑪ 경주간격 raw 일수', () => {
    expect(val({ ...base, intervalDays: 21 }, 'interval_days')).toBe(21);
  });
  it('⑦ track_improvement: 같은 주로에서 더 좋으면(착순 작음) 양수', () => {
    const input: ScoreEngineInput = { ...base, overallOrds: [5, 6], sameTrackOrds: [2, 3] };
    // mean(overall)=5.5, mean(sameTrack)=2.5 → +3
    expect(val(input, 'track_improvement')).toBeCloseTo(3, 5);
  });
  it('⑤ late_gain_mean: 출발보다 결승서 전진하면 양수', () => {
    const input: ScoreEngineInput = {
      ...base,
      positions: [{ startOrd: 8, finishOrd: 2, fieldSize: 10 }],
    };
    // startRatio=7/9, finishRatio=1/9, gain=6/9>0
    expect(val(input, 'late_gain_mean')!).toBeGreaterThan(0);
  });
});

describe('buildFeatures — count·missing·one-hot', () => {
  it('표본수 feature를 동반한다', () => {
    expect(val({ rating: 0, jockeyRecentOrds: [1, 2, 3] }, 'jockey_recent_n')).toBe(3);
  });
  it('거리적성 결측이면 missing 플래그=1', () => {
    expect(val({ rating: 0 }, 'dist_finish_ratio__missing')).toBe(1);
  });
  it('거리적성 있으면 missing 플래그=0', () => {
    expect(val({ rating: 0, distFinishRatio: 0.3 }, 'dist_finish_ratio__missing')).toBe(0);
  });
  it('성별 one-hot', () => {
    expect(val({ rating: 0, sex: '암' }, 'sex_mare')).toBe(1);
    expect(val({ rating: 0, sex: '수' }, 'sex_mare')).toBe(0);
  });
  it('페이스 one-hot', () => {
    expect(val({ rating: 0, paceType: 'HOT' }, 'pace_hot')).toBe(1);
  });
});
