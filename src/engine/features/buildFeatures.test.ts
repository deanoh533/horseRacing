import { describe, it, expect } from 'vitest';
import { buildFeatures } from './buildFeatures.js';
import type { ScoreEngineInput } from '../index.js';
import { featureToItem } from './featureItemMap.js';

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
  it('⑱ 통산 클래스: finish_ratio·place_rate raw 통과, career_n 동반', () => {
    const input = { ...base, careerFinishRatio: 0.2, careerPlaceRate: 0.6, careerN: 5 };
    expect(val(input, 'career_finish_ratio')).toBeCloseTo(0.2, 5);
    expect(val(input, 'career_place_rate')).toBeCloseTo(0.6, 5);
    expect(val(input, 'career_n')).toBe(5);
  });
  it('⑱ 진짜 as-of 수득상금 log1p (클래스 신호와 병존)', () => {
    const input = { ...base, earningsAsof: 100_000_000, careerFinishRatio: 0.2 };
    expect(val(input, 'earnings_asof_log')).toBeCloseTo(Math.log1p(100_000_000), 5);
    expect(val(input, 'career_finish_ratio')).toBeCloseTo(0.2, 5); // 병존 확인
  });
  it('⑱ earnings_asof 결측이면 missing=1', () => {
    expect(val({ ...base }, 'earnings_asof_log__missing')).toBe(1);
  });
  it('⑱ earnings_log는 더 이상 출력 안 함 (누수 제거)', () => {
    expect(val({ ...base, erngSump: 100_000_000 }, 'earnings_log')).toBeUndefined();
  });
  it('⑱ 통산 클래스 결측이면 missing=1, career_n=0', () => {
    expect(val({ ...base }, 'career_finish_ratio__missing')).toBe(1);
    expect(val({ ...base }, 'career_place_rate__missing')).toBe(1);
    expect(val({ ...base }, 'career_n')).toBe(0);
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
  it('신규 구간 후보: 초반/종반 순위 raw+비율, 종반속도, 상승폭', () => {
    const input: ScoreEngineInput = {
      ...base,
      positions: [
        { startOrd: 6, finishOrd: 2, fieldSize: 11, g1fOrd: 4, last200mTime: 12.5 },
        { startOrd: 8, finishOrd: 4, fieldSize: 11, g1fOrd: 6, last200mTime: 13.5 },
      ],
    };
    // ① 초반 200m 순위: raw 등수 평균=(6+8)/2=7, 비율 평균=((5/10)+(7/10))/2=0.6
    expect(val(input, 'early_pos_s1f_mean')).toBeCloseTo(7, 5);
    expect(val(input, 'early_pos_s1f_ratio_mean')).toBeCloseTo(0.6, 5);
    // ② 종반 200m 순위: raw=(4+6)/2=5, 비율=((3/10)+(5/10))/2=0.4
    expect(val(input, 'late_pos_g1f_mean')).toBeCloseTo(5, 5);
    expect(val(input, 'late_pos_g1f_ratio_mean')).toBeCloseTo(0.4, 5);
    // ③ 종반 200m 속도: 200/12.5=16, 200/13.5=14.81 → 평균≈15.41 m/s
    expect(val(input, 'late_200m_speed_mean')!).toBeCloseTo((16 + 200 / 13.5) / 2, 4);
    // ④ 초반−최종 등수 상승폭: (6-2)+(8-4) = 4,4 → 평균 4
    expect(val(input, 'early_to_finish_gain_mean')).toBeCloseTo(4, 5);
  });
  it('종반 순위/속도는 결측(0/없음)이면 그 항목 생략', () => {
    const input: ScoreEngineInput = {
      ...base,
      positions: [{ startOrd: 5, finishOrd: 3, fieldSize: 8 }], // g1fOrd·last200mTime 없음
    };
    expect(val(input, 'early_pos_s1f_mean')).toBe(5); // 초반은 나옴
    expect(val(input, 'late_pos_g1f_mean')).toBeUndefined();
    expect(val(input, 'late_200m_speed_mean')).toBeUndefined();
  });
  it('등급 이동: class_move = 오늘−직전 밴드 (raw 델타, 음수=하락)', () => {
    expect(val({ rating: 0, classBandToday: 65, classBandLast: 80 }, 'class_move')).toBe(-15);
    expect(val({ rating: 0, classBandToday: 80, classBandLast: 65 }, 'class_move')).toBe(15);
    expect(val({ rating: 0, classBandToday: 65 }, 'class_move')).toBeUndefined(); // 직전 없음
  });
  it('경쟁강도: 필드 평균/최고 레이팅, 내 레이팅−필드평균 격차', () => {
    const input: ScoreEngineInput = { rating: 85, allRaceRatings: [70, 80, 90] };
    expect(val(input, 'field_rating_mean')).toBeCloseTo(80, 5);
    expect(val(input, 'field_rating_max')).toBe(90);
    expect(val(input, 'rating_minus_field_mean')).toBeCloseTo(5, 5);
  });
  it('경쟁강도: 유효 레이팅(>0) 2개 미만이면 생략', () => {
    expect(val({ rating: 85, allRaceRatings: [0, 85, 0] }, 'field_rating_mean')).toBeUndefined();
  });
  it('마체중 절대값 + 필드대비', () => {
    const input: ScoreEngineInput = { rating: 0, bodyWeight: 490, allRaceBodyWeights: [450, 480, 510] };
    expect(val(input, 'body_weight')).toBe(490);
    expect(val(input, 'body_weight_minus_field_mean')).toBeCloseTo(490 - 480, 5);
  });
  it('마체중: bodyWeight 없으면 생략', () => {
    expect(val({ rating: 0 }, 'body_weight')).toBeUndefined();
  });
  it('② 마체중: 최근 변화량(last)과 기울기 (weightDiffs는 과거→최근)', () => {
    const input: ScoreEngineInput = { ...base, weightDiffs: [-2, 0, 4] };
    expect(val(input, 'weight_diff_last')).toBe(4);
    expect(val(input, 'weight_diff_slope')).toBeGreaterThan(0); // 증가 추세
  });
  it('② weightDiffs 없으면 last/slope 미출력, n=0', () => {
    expect(val({ rating: 0 }, 'weight_diff_last')).toBeUndefined();
    expect(val({ rating: 0 }, 'weight_diff_n')).toBe(0);
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

describe('buildFeatures — 버킷·교차항', () => {
  it('⑪ 간격 버킷: 28-35일이면 interval_b_28_35=1, 나머지=0', () => {
    const fs = buildFeatures({ rating: 0, intervalDays: 30 });
    expect(fs.find((f) => f.name === 'interval_b_28_35')?.value).toBe(1);
    expect(fs.find((f) => f.name === 'interval_b_lt14')?.value).toBe(0);
    expect(fs.find((f) => f.name === 'interval_b_90p')?.value).toBe(0);
  });
  it('⑪ raw interval_days도 계속 출력 (버킷과 병존)', () => {
    expect(buildFeatures({ rating: 0, intervalDays: 30 }).find((f) => f.name === 'interval_days')?.value).toBe(30);
  });
  it('⑲ 성향×페이스 교차: 도주(avg<=0.15)×HOT', () => {
    const fs = buildFeatures({ rating: 0, runningStyleAvgRatio: 0.1, paceType: 'HOT' });
    expect(fs.find((f) => f.name === 'x_front_hot')?.value).toBe(1);
  });
  it('⑬ 나이×거리 교차: 노령(age>=6)×장거리(rcDist>=1800)', () => {
    const fs = buildFeatures({ rating: 0, age: 6, rcDist: 1800 });
    expect(fs.find((f) => f.name === 'x_old_long')?.value).toBe(1);
  });
  // ⑫b draw×거리 상호작용: 2026-06-16 게이트B 기각(연승 −0.7%p, 흡수). 피처 제거됨.
});

describe('shape 피처 (경주 전개)', () => {
  it('주입값 있으면 shape_pred_gap·shape_p_achieve 추가', () => {
    const f = buildFeatures({ shapePredGap: 0.8, shapePAchieve: 0.23 } as ScoreEngineInput);
    expect(f.find((x) => x.name === 'shape_pred_gap')?.value).toBeCloseTo(0.8, 6);
    expect(f.find((x) => x.name === 'shape_p_achieve')?.value).toBeCloseTo(0.23, 6);
  });

  it('주입 없으면 미생성 (결측 관례)', () => {
    const f = buildFeatures({} as ScoreEngineInput);
    expect(f.find((x) => x.name === 'shape_pred_gap')).toBeUndefined();
    expect(f.find((x) => x.name === 'shape_p_achieve')).toBeUndefined();
  });

  it('predGap만 있고 pAchieve 없으면 gap만 생성', () => {
    const f = buildFeatures({ shapePredGap: 0.3 } as ScoreEngineInput);
    expect(f.find((x) => x.name === 'shape_pred_gap')).toBeDefined();
    expect(f.find((x) => x.name === 'shape_p_achieve')).toBeUndefined();
  });

  it('featureToItem: shape_ 프리픽스 → shape_signal', () => {
    expect(featureToItem('shape_pred_gap')).toBe('shape_signal');
    expect(featureToItem('shape_p_achieve')).toBe('shape_signal');
    expect(featureToItem('shape_p_achieve__missing')).toBe('shape_signal');
  });
});
