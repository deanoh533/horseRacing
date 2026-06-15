export type RunningStyleClass =
  | 'front'
  | 'pace'
  | 'stalker'
  | 'closer'
  | 'free'
  | 'unknown';

export type PaceType = 'HOT' | 'NORMAL' | 'SLOW';

export function classifyRunningStyleFromData(
  avgPositionRatio: number | null | undefined,
  stddevPositionRatio: number | null | undefined
): RunningStyleClass {
  if (avgPositionRatio == null) return 'unknown';
  if (stddevPositionRatio != null && stddevPositionRatio >= 0.35) return 'free';
  if (avgPositionRatio <= 0.15) return 'front';
  if (avgPositionRatio <= 0.35) return 'pace';
  if (avgPositionRatio <= 0.65) return 'stalker';
  return 'closer';
}

// ⚠️ 레거시 경로(rho-legacy ScoreEngine)에서만 사용. 라이브(로지스틱)는 buildFeatures의
// x_*_* one-hot으로 모델이 직접 학습하므로 이 표를 안 봄.
// 2026-06-16: 실측 역전(도주+HOT 좋음 / 추입+HOT·SLOW 나쁨)을 반영해 방향 교정.
// 값 = 활성 로지스틱(id=6)의 학습 계수 순서를 0.20~0.90으로 환산(closer+SLOW 최저, pace+NORMAL 최고).
// 이전 표는 HOT 열이 거꾸로(도주 0.30·추입 0.90)였음.
const SCORE_MAP: Record<RunningStyleClass, Record<PaceType, number>> = {
  front:   { HOT: 0.65, NORMAL: 0.75, SLOW: 0.75 },
  pace:    { HOT: 0.75, NORMAL: 0.90, SLOW: 0.70 },
  stalker: { HOT: 0.60, NORMAL: 0.70, SLOW: 0.80 },
  closer:  { HOT: 0.60, NORMAL: 0.50, SLOW: 0.20 },
  free:    { HOT: 0.60, NORMAL: 0.60, SLOW: 0.60 },
  unknown: { HOT: 0.55, NORMAL: 0.55, SLOW: 0.55 },
};

export interface RunningStylePaceInput {
  avgPositionRatio: number | null | undefined;
  stddevPositionRatio: number | null | undefined;
  paceType: PaceType;
}

export function calculateRunningStylePaceScore(
  input: RunningStylePaceInput
): number {
  const style = classifyRunningStyleFromData(
    input.avgPositionRatio,
    input.stddevPositionRatio
  );
  return SCORE_MAP[style][input.paceType];
}
