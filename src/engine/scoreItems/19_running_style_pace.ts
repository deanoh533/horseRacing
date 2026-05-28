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

const SCORE_MAP: Record<RunningStyleClass, Record<PaceType, number>> = {
  front:   { HOT: 0.30, NORMAL: 0.65, SLOW: 1.00 },
  pace:    { HOT: 0.50, NORMAL: 0.70, SLOW: 0.85 },
  stalker: { HOT: 0.65, NORMAL: 0.60, SLOW: 0.45 },
  closer:  { HOT: 0.90, NORMAL: 0.55, SLOW: 0.25 },
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
