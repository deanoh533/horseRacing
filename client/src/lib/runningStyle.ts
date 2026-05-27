/**
 * 주행 성향 분류 (Step 4 Phase 2)
 *
 * 한국 경마 표준 5분류:
 *   - 도주마 (Front Runner)    : 초반부터 단독 선두
 *   - 선행마 (Pace Maker)      : 선두권 유지
 *   - 선입마 (Stalker)         : 중위권 → 막판 추격
 *   - 추입마 (Closer)          : 최후방 → 후반 폭발
 *   - 자유마 (Freestyle)       : 패턴 없음 (stddev 큼)
 *
 * 임계값은 우리 데이터(3,551마 분포)로 검증 — migrations/008 참고
 */

export type RunningStyle = 'free' | 'front' | 'pace' | 'stalker' | 'closer' | 'unknown';

export interface RunningStyleInfo {
  style: RunningStyle;
  name: string;       // 도주마
  shortName: string;  // 도주
  emoji: string;
  className: string;  // Tailwind 배경+텍스트 색
  description: string;
}

export const STYLE_INFO: Record<RunningStyle, RunningStyleInfo> = {
  front: {
    style: 'front',
    name: '도주마',
    shortName: '도주',
    emoji: '🏁',
    className: 'bg-red-500/20 text-red-300 border-red-500/40',
    description: '출발부터 단독 선두를 유지',
  },
  pace: {
    style: 'pace',
    name: '선행마',
    shortName: '선행',
    emoji: '⚡',
    className: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    description: '선두권에서 페이스 조정',
  },
  stalker: {
    style: 'stalker',
    name: '선입마',
    shortName: '선입',
    emoji: '🎯',
    className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    description: '중위권에서 따라가다 막판 추격',
  },
  closer: {
    style: 'closer',
    name: '추입마',
    shortName: '추입',
    emoji: '💨',
    className: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    description: '후미에서 후반 폭발적 추격',
  },
  free: {
    style: 'free',
    name: '자유마',
    shortName: '자유',
    emoji: '🎲',
    className: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    description: '경주마다 다른 전략 (패턴 없음)',
  },
  unknown: {
    style: 'unknown',
    name: '데이터 부족',
    shortName: '-',
    emoji: '❔',
    className: 'bg-zinc-700/30 text-zinc-400 border-zinc-600/40',
    description: '3경주 미만',
  },
};

/**
 * 분류 알고리즘
 *   1. avgRatio 없으면 unknown
 *   2. stddev ≥ 0.35 → 자유마 (우선)
 *   3. ratio ≤ 0.15 → 도주마
 *   4. ratio ≤ 0.35 → 선행마
 *   5. ratio ≤ 0.65 → 선입마
 *   6. ratio ≤ 1.0  → 추입마
 */
export function classifyRunningStyle(
  avgPositionRatio: number | null | undefined,
  stddevPositionRatio: number | null | undefined
): RunningStyle {
  if (avgPositionRatio == null) return 'unknown';
  if (stddevPositionRatio != null && stddevPositionRatio >= 0.35) return 'free';
  if (avgPositionRatio <= 0.15) return 'front';
  if (avgPositionRatio <= 0.35) return 'pace';
  if (avgPositionRatio <= 0.65) return 'stalker';
  return 'closer';
}

/**
 * front_run_success_rate 해석
 *   "출발 상위 30%였을 때 결승 상위 30%에 도달한 비율"
 *   선행마/도주마의 실제 성공도 측정
 */
export function describeFrontRunSuccess(rate: number | null | undefined): string {
  if (rate == null) return '데이터 없음 (선행 경험 없음)';
  if (rate >= 0.7) return `매우 높음 (${Math.round(rate * 100)}%)`;
  if (rate >= 0.5) return `높음 (${Math.round(rate * 100)}%)`;
  if (rate >= 0.3) return `보통 (${Math.round(rate * 100)}%)`;
  return `낮음 (${Math.round(rate * 100)}%) — 선행 후 후퇴 경향`;
}
