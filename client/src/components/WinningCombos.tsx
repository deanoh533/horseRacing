import { useMemo } from 'react';
import { useComboDividends, useHorsesByRace } from '../lib/queries';
import { winningComboPayouts, POOL_LABELS } from '../lib/combos';

/** 순서有 pool은 → , 순서無는 - 로 leg 표기 */
const ORDERED_POOLS = new Set(['쌍승식', '삼쌍승식']);

/**
 * 적중 조합 배당 섹션 (경주 단위, 자기완결·자기게이트).
 * 결과 전이거나 combo 데이터/적중 조합이 없으면 null 렌더.
 */
export function WinningCombos({
  rcDate,
  meet,
  rcNo,
  compact = false,
}: {
  rcDate: number;
  meet: number;
  rcNo: number;
  compact?: boolean;
}) {
  const { data: combos } = useComboDividends(rcDate, meet, rcNo);
  const { data: horses } = useHorsesByRace(rcDate, meet, rcNo);

  const gates = useMemo(() => {
    return (horses ?? [])
      .filter((h) => h.ord != null && h.ord >= 1 && h.ord <= 3)
      .sort((a, b) => (a.ord as number) - (b.ord as number))
      .map((h) => h.pthr_no);
  }, [horses]);

  const rows = useMemo(
    () => (combos && combos.length > 0 && gates.length >= 2 ? winningComboPayouts(combos, gates) : []),
    [combos, gates]
  );

  if (rows.length === 0) return null;

  const fmtLegs = (pool: string, legs: number[]) =>
    legs.join(ORDERED_POOLS.has(pool) ? '→' : '-');

  return (
    <div
      className={`bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-bg-elevated)] ${
        compact ? 'mt-2 p-3' : 'p-4'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent-cyan)] mb-2 font-semibold">
        [적중 조합 배당]
      </div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li
            key={`${r.pool}-${r.legs.join('-')}-${i}`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-[var(--color-text-secondary)] flex-shrink-0">
              {POOL_LABELS[r.pool] ?? r.pool}{' '}
              <span className="font-mono-num text-[var(--color-text-disabled)]">
                {fmtLegs(r.pool, r.legs)}
              </span>
            </span>
            <span className="font-mono-num text-[var(--color-text-primary)] text-right">
              {r.odds}배
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
