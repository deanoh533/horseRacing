/**
 * 경주 단위 페이스 예상 (F-001) — 순수 계산 + 표시 상수.
 * 판정 규칙은 서버 src/engine/scorePredictor.ts:computePaceType 과 동일해야 한다
 * (선두권 = front|pace = avg≤0.35 & 자유마 제외, ≥3 HOT / ≤1 SLOW / 그 외 NORMAL).
 * 서버 규칙 변경 시 이 파일과 pace.test.ts의 동치 테스트를 함께 갱신할 것.
 * 스펙: docs/superpowers/specs/2026-07-16-f001-pace-ui-design.md
 */
import type { RunningStyle } from './runningStyle';
import paceParJson from '../config/pace_par.json';

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

const PACE_PAR = paceParJson as Record<string, number>;

/**
 * 실측 페이스 — 그 경주 avg_s1f가 par(meet×거리 중앙값)보다 빨랐/느렸나.
 * 서버 SSOT: src/engine/features/paceForm.ts labelPastRacePace (±0.11초). par: src/engine/pacePar.ts.
 * par JSON은 npm run export:pace-par로 생성.
 */
export function labelActualPace(
  avgS1f: number | null,
  meet: number,
  dist: number | null
): PaceType | null {
  if (avgS1f == null || !(avgS1f > 0) || dist == null) return null;
  const par = PACE_PAR[`${meet}|${dist}`];
  if (par == null) return null;
  const d = avgS1f - par;
  if (d <= -0.11) return 'HOT';
  if (d >= 0.11) return 'SLOW';
  return 'NORMAL';
}

export type PaceMatch = 'exact' | 'adjacent' | 'opposite';

const PACE_ORD: Record<PaceType, number> = { HOT: 0, NORMAL: 1, SLOW: 2 };

/** 예측 vs 실측 3단계 일치도 (HOT<NORMAL<SLOW ordinal 차이). */
export function paceMatchLevel(predicted: PaceType, actual: PaceType): PaceMatch {
  const diff = Math.abs(PACE_ORD[predicted] - PACE_ORD[actual]);
  return diff === 0 ? 'exact' : diff === 1 ? 'adjacent' : 'opposite';
}

export const PACE_MATCH_UI: Record<PaceMatch, { symbol: string; label: string; className: string }> = {
  exact: { symbol: '✅', label: '예측 적중', className: 'text-emerald-300' },
  adjacent: { symbol: '≈', label: '근접', className: 'text-amber-300' },
  opposite: { symbol: '❌', label: '빗나감', className: 'text-red-400' },
};
