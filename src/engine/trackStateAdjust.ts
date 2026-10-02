/**
 * 주로 상태 → 전개 시간 건조 환산 (포화·불량만).
 * 계수: 2024-01-01 미만 데이터의 말·경마장×거리 고정효과 회귀(scripts/probe_track_effect.ts --until 20240101).
 * 동결 — 라이브 표본이 늘어도 임의로 바꾸지 않는다. 스펙 2026-09-30-shape-track-state-adjust-design.md
 */
export type ShapePart = 'early' | 'late';

export const SHAPE_STATE_COEF: Record<'포화' | '불량', Record<ShapePart, number>> = {
  포화: { early: -0.0141, late: -0.0093 },
  불량: { early: -0.0215, late: -0.0178 },
};

export function stateCoef(state: string | null | undefined, part: ShapePart): number {
  if (state === '포화' || state === '불량') return SHAPE_STATE_COEF[state][part];
  return 0;
}

export function toDryTime(seconds: number, state: string | null | undefined, part: ShapePart): number {
  const c = stateCoef(state, part);
  return c === 0 ? seconds : seconds / (1 + c);
}

export function fromDryTime(seconds: number, state: string | null | undefined, part: ShapePart): number {
  const c = stateCoef(state, part);
  return c === 0 ? seconds : seconds * (1 + c);
}

export function adjustShapeTimes(
  g3fAcc: number,
  rcTime: number,
  state: string | null | undefined,
): { g3fAcc: number; rcTime: number } {
  if (stateCoef(state, 'early') === 0 && stateCoef(state, 'late') === 0) return { g3fAcc, rcTime };
  const g3 = toDryTime(g3fAcc, state, 'early');
  const f6 = toDryTime(rcTime - g3fAcc, state, 'late');
  return { g3fAcc: g3, rcTime: g3 + f6 };
}
