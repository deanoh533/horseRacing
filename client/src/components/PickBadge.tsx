import { classifyPick, tierLabel } from '../lib/selectivePicks';

/** p_top3 → 강추/주목 칩. 임계값 미달·미확정(config 0)·null이면 렌더 안 함. */
export function PickBadge({ pTop3 }: { pTop3: number | null | undefined }) {
  const tier = classifyPick(pTop3);
  if (tier === null) return null;
  const cls =
    tier === 'strong'
      ? 'bg-amber-400 text-black'
      : 'bg-[var(--color-bg-elevated)] text-amber-300 border border-amber-400/40';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${cls}`}>
      {tierLabel(tier)}
    </span>
  );
}
