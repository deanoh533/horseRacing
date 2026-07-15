/**
 * 페이스 조건부 성적 (pace_fit·pace_sens) — 순수 계산.
 * 스펙: docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md §2·§3
 * 과거 경주의 실측 페이스(초반 200m vs par) 라벨 × finish_ratio 버킷 집계.
 * 임계값·K는 probe:pace-form 분포로 확정된 값 (아래 상수 주석 참조).
 */
export type PaceBucket = 'HOT' | 'NORMAL' | 'SLOW';

// probe:pace-form 2026-07-15: 경주 7805건(par 15버킷, 커버리지 99.8%) delta 분위
// p10=-0.270 p30=-0.110 p50=0.000 p70=0.110 p90=0.285 → 30/70 분위로 HOT/SLOW 확정(직관 ±0.25초 대비 절반).
// 말별 HOT 버킷 n 분위: p50=2 p70=4 p90=9, 0 제외 중앙값=3 → K는 직관값 3과 일치, 유지.
export const PACE_HOT_DELTA = -0.11;  // avg_s1f − par ≤ 이 값(초) → HOT
export const PACE_SLOW_DELTA = 0.11;  // avg_s1f − par ≥ 이 값(초) → SLOW
export const PACE_FIT_SHRINK_K = 3;   // pace_fit 수축: × n/(n+K)
const SENS_MIN_N = 2;                 // pace_sens에 참여하는 버킷 최소 표본

export function labelPastRacePace(
  avgS1f: number | null | undefined,
  parS1f: number | null | undefined
): PaceBucket | null {
  if (avgS1f == null || parS1f == null || !(avgS1f > 0)) return null;
  const d = avgS1f - parS1f;
  if (d <= PACE_HOT_DELTA) return 'HOT';
  if (d >= PACE_SLOW_DELTA) return 'SLOW';
  return 'NORMAL';
}

export interface PaceBucketStat { mean: number; n: number }
export type PaceFormStats = Partial<Record<PaceBucket, PaceBucketStat>>;

export function computePaceFormStats(
  races: Array<{ finishRatio: number; paceLabel: PaceBucket | null }>
): PaceFormStats {
  const acc = new Map<PaceBucket, number[]>();
  for (const r of races) {
    if (r.paceLabel == null) continue;
    const a = acc.get(r.paceLabel);
    if (a) a.push(r.finishRatio); else acc.set(r.paceLabel, [r.finishRatio]);
  }
  const out: PaceFormStats = {};
  for (const [k, v] of acc) out[k] = { mean: v.reduce((s, x) => s + x, 0) / v.length, n: v.length };
  return out;
}

export interface PaceFormFeatureOut { paceFit: number | null; paceSens: number | null; paceFitN: number }

export function paceFormFeatures(
  stats: PaceFormStats | undefined,
  careerFinishRatio: number | null | undefined,
  currentPace: PaceBucket
): PaceFormFeatureOut {
  const bucket = stats?.[currentPace];
  const paceFitN = bucket?.n ?? 0;
  let paceFit: number | null = null;
  if (bucket && careerFinishRatio != null) {
    paceFit = (bucket.mean - careerFinishRatio) * (bucket.n / (bucket.n + PACE_FIT_SHRINK_K));
  }
  const means = (['HOT', 'NORMAL', 'SLOW'] as const)
    .map((b) => stats?.[b])
    .filter((s): s is PaceBucketStat => s != null && s.n >= SENS_MIN_N)
    .map((s) => s.mean);
  const paceSens = means.length >= 2 ? Math.max(...means) - Math.min(...means) : null;
  return { paceFit, paceSens, paceFitN };
}
