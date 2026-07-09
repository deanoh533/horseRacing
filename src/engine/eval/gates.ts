import { featureToItem } from '../features/featureItemMap.js';
import { buildSchema, toVector } from '../features/alignFeatures.js';
import { fitLogistic } from '../models/logistic.js';
import type { RaceRecord } from './types.js';
import { scoreHoldout, placeHitRate, fadeHitRate, quinellaHitRate } from './gateMetrics.js';

// ── 게이트 A: 피처 상관계수 ───────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return Math.sqrt(dx * dy) === 0 ? 0 : num / Math.sqrt(dx * dy);
}

export interface GateAWarning {
  newFeat: string;
  existingFeat: string;
  r: number;
}

export function runGateA(races: RaceRecord[]): GateAWarning[] {
  // 모든 피처 이름 수집
  const allFeats = new Set<string>();
  for (const race of races)
    for (const h of race.horses)
      for (const f of h.features) allFeats.add(f.name);

  const featNames = [...allFeats].sort();

  // 피처별 값 벡터 (말 단위)
  const vectors = new Map<string, number[]>();
  for (const name of featNames) vectors.set(name, []);
  for (const race of races)
    for (const h of race.horses) {
      const present = new Map(h.features.map((f) => [f.name, f.value]));
      for (const name of featNames)
        vectors.get(name)!.push(present.get(name) ?? 0);
    }

  const warnings: GateAWarning[] = [];
  const THRESHOLD = 0.5;
  const names = featNames.filter((n) => !n.endsWith('__missing'));

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!, b = names[j]!;
      // 같은 ScoreItem끼리는 비교 생략
      if (featureToItem(a) === featureToItem(b)) continue;
      const r = pearson(vectors.get(a)!, vectors.get(b)!);
      if (Number.isFinite(r) && Math.abs(r) > THRESHOLD) {
        warnings.push({ newFeat: a, existingFeat: b, r });
      }
    }
  }
  return warnings;
}

export function printGateA(warnings: GateAWarning[]): void {
  if (warnings.length === 0) {
    console.log('  ✅ 게이트 A: 이상 없음');
    return;
  }
  console.log(`  ⚠️  게이트 A: ${warnings.length}개 상관 경고 (|r|>0.5)`);
  for (const w of warnings.slice(0, 10)) {
    console.log(
      `     [${w.newFeat}] ↔ [${w.existingFeat}] r=${w.r.toFixed(2)}`
      + `\n       → 상관이 높아도 독립 정보 가능. 포함 여부는 게이트 B 판단.`
    );
  }
  if (warnings.length > 10) console.log(`     ... 외 ${warnings.length - 10}개`);
}

// ── 게이트 B: 연승률 개선량 ───────────────────────────────────────

export const GATE_B_HOLDOUT_START = 20251001;
export const GATE_B_HOLDOUT_END   = 20251231;

export interface GateBResult {
  itemId: string;
  include: boolean;
  delta: number;       // = placeDelta (하위호환·채택기준)
  withRate: number;
  withoutRate: number;
  fadeDelta: number;   // fade 개선량
  quinDelta: number;   // 복승 개선량
}

export function runGateB(
  races: RaceRecord[],
  holdout: { start: number; end: number } = { start: GATE_B_HOLDOUT_START, end: GATE_B_HOLDOUT_END },
): GateBResult[] {
  const gateTrain = races.filter((r) => r.raceDate < holdout.start);
  const gateHoldout = races.filter(
    (r) => r.raceDate >= holdout.start && r.raceDate <= holdout.end
  );
  if (gateHoldout.length < 50) {
    console.warn('  ⚠️  게이트 B holdout 경주 수 부족 (<50). 결과 신뢰도 낮음.');
  }

  // 모든 ScoreItem ID 목록
  const itemIds = [...new Set(
    races.flatMap((r) => r.horses.flatMap((h) =>
      h.features.map((f) => featureToItem(f.name))
    ))
  )].filter((id) => id !== 'context' && id !== '').sort();

  // 전체 피처 스키마 (__missing 제거 — trainAllModels와 동일 조건)
  const allFeatures = buildSchema(gateTrain.flatMap((r) => r.horses.map((h) => h.features)))
    .filter((n) => !n.endsWith('__missing'));

  // 학습 행렬
  const trainX = gateTrain.flatMap((r) =>
    r.horses.map((h) => toVector(h.features, allFeatures))
  );
  const trainY = gateTrain.flatMap((r) =>
    r.horses.map((h) => (h.ord <= 3 ? 1 : 0))
  );

  // 기준선: 전체 피처 모델 → holdout 3지표
  const modelAll = fitLogistic(trainX, trainY, allFeatures);
  const baseScored = scoreHoldout(modelAll, gateHoldout, allFeatures);
  const basePlace = placeHitRate(baseScored);
  const baseFade = fadeHitRate(baseScored);
  const baseQuin = quinellaHitRate(baseScored);

  const results: GateBResult[] = [];
  for (const itemId of itemIds) {
    const itemFeats = allFeatures.filter((n) => featureToItem(n) === itemId);
    if (itemFeats.length === 0) {
      results.push({ itemId, include: false, delta: 0, withRate: basePlace, withoutRate: basePlace, fadeDelta: 0, quinDelta: 0 });
      continue;
    }

    // 해당 항목 제거한 스키마
    const reducedFeatures = allFeatures.filter((n) => featureToItem(n) !== itemId);

    const withoutX = gateTrain.flatMap((r) =>
      r.horses.map((h) => toVector(h.features, reducedFeatures))
    );
    const modelWithout = fitLogistic(withoutX, trainY, reducedFeatures);
    const woScored = scoreHoldout(modelWithout, gateHoldout, reducedFeatures);

    const placeDelta = basePlace - placeHitRate(woScored);
    const fadeDelta = baseFade - fadeHitRate(woScored);
    const quinDelta = baseQuin - quinellaHitRate(woScored);

    results.push({
      itemId,
      include: placeDelta > 0,
      delta: placeDelta,
      withRate: basePlace,
      withoutRate: basePlace - placeDelta,
      fadeDelta,
      quinDelta,
    });
  }
  return results;
}

export function printGateB(results: GateBResult[]): void {
  console.log('\n=== 항목 포함 현황 (연승 채택 / fade·복승 진단) ===\n');
  console.log('항목                   │ 채택      │   연승 │   fade │   복승');
  console.log('─'.repeat(66));
  const pct = (d: number) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%p`.padStart(7);
  for (const r of [...results].sort((a, b) => b.delta - a.delta)) {
    const mark = r.include ? '✅ 포함  ' : '⚠️  제외  ';
    console.log(
      `${r.itemId.padEnd(23)}│ ${mark.padEnd(9)}│ ${pct(r.delta)} │ ${pct(r.fadeDelta)} │ ${pct(r.quinDelta)}`
    );
  }
}
