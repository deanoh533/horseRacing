import config from '../config/selective_picks.json';

export type PickTier = 'strong' | 'watch' | null;

/** src/engine/eval/selectivePicks.ts classifyTier와 동일 로직(설정값 주입). */
export function classifyPickWith(
  pTop3: number | null | undefined,
  strongMin: number,
  watchMin: number,
): PickTier {
  if (pTop3 == null) return null;
  if (strongMin > 0 && pTop3 >= strongMin) return 'strong';
  if (watchMin > 0 && pTop3 >= watchMin) return 'watch';
  return null;
}

/** config 임계값으로 분류. minProb 0(미확정)이면 전부 null → UI 자동 미노출. */
export function classifyPick(pTop3: number | null | undefined): PickTier {
  return classifyPickWith(pTop3, config.tiers.strong.minProb, config.tiers.watch.minProb);
}

export function tierLabel(t: PickTier): string | null {
  if (t === 'strong') return config.tiers.strong.label;
  if (t === 'watch') return config.tiers.watch.label;
  return null;
}

export const pickConfig = config;
