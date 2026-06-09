/**
 * 경주 내 상대화 (within-race z-score).
 *
 * 원칙: 압축(여러 지표→한 점수)은 모델에 맡기고, 사람은 raw를 경주 내 상대화해
 * 공급만 한다. 절대값 피처는 "8두 경주 vs 16두 경주"에서 의미가 달라지므로,
 * 각 연속형 실력 지표를 그 경주 출전마들 사이의 z-score로 변환한 버전을 **추가**한다.
 * (기존 절대값은 그대로 두고 `<name>_z`를 덧붙임 — 모델이 둘 다 보고 학습.)
 *
 * 패리티 주의: 학습행렬 추출과 라이브 스코어링 양쪽에서 동일하게 호출해야
 * 오프라인==라이브 점수가 일치한다.
 */
import { buildFeatures } from './buildFeatures.js';
import type { ScoreEngineInput } from '../index.js';
import type { Feature } from './types.js';

/**
 * 경주 내 z-score 대상 — 연속형 per-horse 실력 지표 32개.
 * 제외: 이미 상대화된 것(rating_rel·gate_relative), 경주 단위 상수(rc_dist·pace_*),
 * 이진 one-hot(interval_b_*·x_*·sex_*), 표본수 카운트(*_n, 신뢰도 신호), 결측 플래그.
 */
export const RELATIVIZE_FEATURES: readonly string[] = [
  'rating_abs',
  'weight_diff_last', 'weight_diff_slope',
  'recent_ord_mean', 'recent_ord_slope', 'recent_ord_std', 'recent_ord_last',
  'sectional_total_improve', 'sectional_last_improve',
  'late_finish_ratio_mean', 'late_gain_mean',
  'dist_finish_ratio',
  'track_improvement',
  'burden_over_avg', 'burden_ord_mean',
  'jockey_career_qu', 'jockey_career_win', 'jockey_recent_win',
  'trainer_top3', 'trainer_recent_top2',
  'interval_days',
  'age',
  'pedigree_dsa_mean',
  'season_top3',
  'chemistry_improvement',
  'recent_pop_top2',
  'career_finish_ratio', 'career_place_rate', 'earnings_asof_log',
  'style_avg_ratio', 'style_stddev',
  'speed_ability_raw',
];

/** 그 말이 해당 피처를 "실제로 가졌나" (이름 존재 AND __missing≠1). */
function isPresent(m: Map<string, number>, name: string): boolean {
  if (!m.has(name)) return false;
  if (m.get(`${name}__missing`) === 1) return false;
  return true;
}

/**
 * 한 경주의 출전마별 feature 배열을 받아, RELATIVIZE_FEATURES에 대해
 * 경주 내 z-score(`<name>_z`)를 추가한 새 배열을 반환한다.
 *
 * - 통계(평균·모집단 표준편차)는 present(결측 아님)인 말들로만 계산.
 * - present가 2 미만이면 그 피처는 생략(필드 정보 부족).
 * - 표준편차 0이면 z=0.
 * - 결측 말에는 `_z`를 붙이지 않음(toVector에서 0으로 채워져 패리티 유지).
 */
export function relativizeRace(perHorse: Feature[][]): Feature[][] {
  const maps = perHorse.map((fs) => new Map(fs.map((f) => [f.name, f.value])));
  const out = perHorse.map((fs) => [...fs]);

  for (const name of RELATIVIZE_FEATURES) {
    const present: { i: number; v: number }[] = [];
    maps.forEach((m, i) => {
      if (isPresent(m, name)) present.push({ i, v: m.get(name)! });
    });
    if (present.length < 2) continue;

    const mean = present.reduce((s, p) => s + p.v, 0) / present.length;
    const variance = present.reduce((s, p) => s + (p.v - mean) ** 2, 0) / present.length;
    const std = Math.sqrt(variance);

    for (const p of present) {
      out[p.i]!.push({ name: `${name}_z`, value: std === 0 ? 0 : (p.v - mean) / std });
    }
  }
  return out;
}

/**
 * 한 경주 출전마 입력 배열 → 경주 내 상대화까지 적용한 feature 배열.
 * 학습행렬 추출·라이브 스코어링 공통 진입점.
 */
export function buildRaceFeatures(inputs: ScoreEngineInput[]): Feature[][] {
  return relativizeRace(inputs.map((input) => buildFeatures(input)));
}
