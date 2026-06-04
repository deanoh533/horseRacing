/**
 * 로지스틱 라이브 스코어러.
 * total = predictLogit, 피처 기여도 βᵢ·zᵢ를 21항목으로 묶어 item_scores 어댑터 생성.
 * 스펙: docs/superpowers/specs/2026-06-04-stage1-logistic-productionization-design.md
 */
import type { LogisticModel } from './models/logistic.js';
import type { ScoreEngineInput, ItemScore, HorseScoreResult } from './index.js';
import { buildFeatures } from './features/buildFeatures.js';
import { featureToItem } from './features/featureItemMap.js';
import { ITEM_NAMES } from '../types/index.js';

/** 피처 기여도(βᵢ·zᵢ)를 항목별 합산 + 총 logit. 스키마=model.features. */
export function itemContributions(
  model: LogisticModel, features: { name: string; value: number }[],
): { total: number; byItem: Record<string, number> } {
  const valByName = new Map(features.map((f) => [f.name, f.value]));
  const byItem: Record<string, number> = {};
  let total = model.intercept;
  model.features.forEach((name, j) => {
    if (!valByName.has(name)) return;
    const raw = valByName.get(name)!;
    const z = (raw - model.means[j]!) / model.stds[j]!;
    const contrib = (model.coef[name] ?? 0) * z;
    total += contrib;
    const item = featureToItem(name);
    byItem[item] = (byItem[item] ?? 0) + contrib;
  });
  return { total, byItem };
}

/** 라이브 로지스틱 점수: 총점 + item_scores(어댑터). */
export function scoreLogistic(model: LogisticModel, input: ScoreEngineInput): HorseScoreResult {
  const features = buildFeatures(input);
  const { total, byItem } = itemContributions(model, features);
  const items: Record<string, ItemScore> = {};
  for (const [itemId, contrib] of Object.entries(byItem)) {
    items[itemId] = {
      itemId: itemId as ItemScore['itemId'],
      itemName: (ITEM_NAMES as Record<string, string>)[itemId] ?? itemId,
      rawScore: 1 / (1 + Math.exp(-contrib)),
      weight: Math.abs(contrib),
      weightedScore: contrib,
      status: 'implemented',
    };
  }
  return { total, items: items as HorseScoreResult['items'] };
}
