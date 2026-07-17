import { computeRacePace, PACE_UI } from '../lib/pace';
import type { RunningStyle } from '../lib/runningStyle';

/**
 * 경주 페이스 예상 배지 (F-001): 배지 + 근거(선두권 N마리) + 실측 해석 1줄.
 * 판정 불가(성향 데이터 절반 미만)면 회색 안내. 스타일 선례: PickBadge.tsx.
 */
export function RacePaceBadge({ styles }: { styles: RunningStyle[] }) {
  const pace = computeRacePace(styles);
  if (pace === null) {
    return (
      <div className="text-xs text-[var(--color-text-disabled)]">
        페이스 판정 불가 — 성향 데이터 부족
      </div>
    );
  }
  const ui = PACE_UI[pace.paceType];
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold leading-none ${ui.className}`}>
          {ui.emoji} {ui.label}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">
          선두권 {pace.frontCount}마리 <span className="text-[var(--color-text-disabled)]">({pace.knownCount}/{pace.total}두 분석)</span>
        </span>
      </div>
      <p className="text-[11px] text-[var(--color-text-disabled)]">{ui.insight}</p>
    </div>
  );
}
