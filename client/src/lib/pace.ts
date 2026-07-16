/**
 * 경주 단위 페이스 예상 (F-001) — 순수 계산 + 표시 상수.
 * 판정 규칙은 서버 src/engine/scorePredictor.ts:computePaceType 과 동일해야 한다
 * (선두권 = front|pace = avg≤0.35 & 자유마 제외, ≥3 HOT / ≤1 SLOW / 그 외 NORMAL).
 * 서버 규칙 변경 시 이 파일과 pace.test.ts의 동치 테스트를 함께 갱신할 것.
 * 스펙: docs/superpowers/specs/2026-07-16-f001-pace-ui-design.md
 */
import type { RunningStyle } from './runningStyle';

export type PaceType = 'HOT' | 'NORMAL' | 'SLOW';

export interface RacePaceResult {
  paceType: PaceType;
  frontCount: number; // 선두권(도주+선행, 자유마 제외) 마릿수
  knownCount: number; // 성향 데이터 보유 말 수
  total: number;      // 전체 출전마 수
}

/**
 * 출전마 성향 배열 → 경주 페이스 예상.
 * null = 판정 불가 (성향 데이터 보유 말이 절반 미만 — 표시 전용 가드, 산식 아님).
 */
export function computeRacePace(styles: RunningStyle[]): RacePaceResult | null {
  const total = styles.length;
  if (total === 0) return null;
  let frontCount = 0;
  let knownCount = 0;
  for (const s of styles) {
    if (s === 'unknown') continue;
    knownCount++;
    if (s === 'front' || s === 'pace') frontCount++;
  }
  if (knownCount < total / 2) return null;
  const paceType: PaceType = frontCount >= 3 ? 'HOT' : frontCount <= 1 ? 'SLOW' : 'NORMAL';
  return { paceType, frontCount, knownCount, total };
}

/** 해석 문구는 ⑲ 실측(2026-06-16, SCORE_MAP 교정 데이터) 기반 — 스펙 §4 고정 문구. */
export const PACE_UI: Record<PaceType, { emoji: string; label: string; insight: string; className: string }> = {
  HOT: {
    emoji: '🔥',
    label: '접전 예상',
    insight: '접전 경주 실측: 도주마 승률 21% vs 추입마 4% — 선두권이 오히려 유리했던 게 실측',
    className: 'bg-red-500/20 text-red-300 border-red-500/40',
  },
  NORMAL: {
    emoji: '➖',
    label: '보통 전개',
    insight: '보통 전개 실측: 선행마가 가장 안정적, 추입마는 평균 이하',
    className: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40',
  },
  SLOW: {
    emoji: '🐢',
    label: '느린 전개 예상',
    insight: '느린 전개 실측: 추입마 최악(막판 가속 여지 없음), 선입마 유리',
    className: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
};
