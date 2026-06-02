/**
 * 항목 ⑳ 속도능력지수
 *
 * 거리·주로별 par-time 대비 완주시간 비율(figure)의 최근 N경주 평균(abilityRaw)을
 * 전역 분포 기준으로 0~1에 선형 매핑한다. 절대성 보존을 위해 경주 내 percentile은 쓰지 않는다.
 *
 * LO/HI: 전역 abilityRaw 분포의 p5/p95 (scripts/probe_speed_figure.ts로 확정).
 */

/** 최근 N경주 figure 평균 윈도우 (튜닝 대상) */
export const SPEED_FIGURE_N = 5;
/** 매핑 하한 (probe p5로 확정 예정 — 임시값) */
export const SPEED_FIGURE_LO = 0.93;
/** 매핑 상한 (probe p95로 확정 예정 — 임시값) */
export const SPEED_FIGURE_HI = 1.02;

export interface SpeedFigureInput {
  /** 최근 N경주 figure 평균 (as-of). null = 이력 없음 */
  abilityRaw: number | null;
}

export function calculateSpeedFigureScore(input: SpeedFigureInput): number {
  const { abilityRaw } = input;
  if (abilityRaw == null) return 0.5;
  const score = (abilityRaw - SPEED_FIGURE_LO) / (SPEED_FIGURE_HI - SPEED_FIGURE_LO);
  return Math.max(0, Math.min(1, score));
}
