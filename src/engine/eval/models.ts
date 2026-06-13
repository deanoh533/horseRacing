import { buildSchema, toVector } from '../features/alignFeatures.js';
import { featureToItem } from '../features/featureItemMap.js';
import { fitLogistic } from '../models/logistic.js';
import { fitGBDT } from '../models/gbdt.js';
import { fitPL } from '../models/plackettLuce.js';
import type { RaceRecord } from './types.js';

// ── Spearman weights 학습 ─────────────────────────────────────────

function spearmanRho(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const rank = (arr: number[]) => {
    const sorted = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length).fill(0) as number[];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1]![0] === sorted[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[sorted[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx, b = ry[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return Math.sqrt(dx * dy) === 0 ? 0 : num / Math.sqrt(dx * dy);
}

export function learnSpearman(races: RaceRecord[]): Record<string, number> {
  // 모든 ScoreItem ID 수집
  const allItemIds = new Set<string>();
  for (const race of races)
    for (const h of race.horses)
      for (const id of Object.keys(h.rawScores)) allItemIds.add(id);

  const sumRho: Record<string, number> = {};
  const cnt: Record<string, number> = {};

  for (const race of races) {
    if (race.horses.length < 3) continue;
    for (const itemId of allItemIds) {
      const xs = race.horses.map((h) => h.rawScores[itemId] ?? 0);
      const ys = race.horses.map((h) => -h.ord); // 낮은 ord = 좋음
      const rho = spearmanRho(xs, ys);
      if (Number.isFinite(rho)) {
        sumRho[itemId] = (sumRho[itemId] ?? 0) + rho;
        cnt[itemId] = (cnt[itemId] ?? 0) + 1;
      }
    }
  }

  // 평균 ρ → ReLU(ρ) 정규화 (양의 상관만, 합=1)
  const weights: Record<string, number> = {};
  let total = 0;
  for (const id of allItemIds) {
    const avgRho = cnt[id] ? sumRho[id]! / cnt[id]! : 0;
    weights[id] = Math.max(0, avgRho);
    total += weights[id];
  }
  if (total > 0) for (const id of allItemIds) weights[id] /= total;
  return weights;
}

// ── 9개 모델 학습 ─────────────────────────────────────────────────

export interface TrainedModels {
  spearmanWeights: Record<string, number>;
  logisticTop1: ReturnType<typeof fitLogistic>;
  logisticTop2: ReturnType<typeof fitLogistic>;
  logisticTop3: ReturnType<typeof fitLogistic>;
  gbdtTop1: ReturnType<typeof fitGBDT>;
  gbdtTop2: ReturnType<typeof fitGBDT>;
  gbdtTop3: ReturnType<typeof fitGBDT>;
  pl: ReturnType<typeof fitPL>;
  featureSchema: string[];
}

export function trainAllModels(
  races: RaceRecord[],
  approvedItems: Set<string>
): TrainedModels {
  console.log('\n학습 중...');

  const allRaceFeatures = races.flatMap((r) => r.horses.map((h) => h.features));
  const fullSchema = buildSchema(allRaceFeatures);
  const featureSchema = fullSchema.filter(
    (name) => approvedItems.has(featureToItem(name)) && !name.endsWith('__missing')
  );

  const X = races.flatMap((r) =>
    r.horses.map((h) => toVector(h.features, featureSchema))
  );
  const yTop1 = races.flatMap((r) => r.horses.map((h) => (h.ord === 1 ? 1 : 0)));
  const yTop2 = races.flatMap((r) => r.horses.map((h) => (h.ord <= 2 ? 1 : 0)));
  const yTop3 = races.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));

  const plRaces = races.map((r) => ({
    horses: r.horses.map((h) => ({ x: toVector(h.features, featureSchema), ord: h.ord })),
  }));

  return {
    spearmanWeights: learnSpearman(races),
    logisticTop1: fitLogistic(X, yTop1, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    logisticTop2: fitLogistic(X, yTop2, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    logisticTop3: fitLogistic(X, yTop3, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    gbdtTop1: fitGBDT(X, yTop1, featureSchema),
    gbdtTop2: fitGBDT(X, yTop2, featureSchema),
    gbdtTop3: fitGBDT(X, yTop3, featureSchema),
    pl: fitPL(plRaces, featureSchema),
    featureSchema,
  };
}
