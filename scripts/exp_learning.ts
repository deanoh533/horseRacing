/**
 * 학습 방식 실험 (spec 2026-09-18 §7). DuckDB 미러 읽기 전용, DB 쓰기 없음.
 * 피처 스키마 = 활성 모델(v7) artifact.features 고정 → 학습 방식 차이만 비교.
 *   E0: 수렴 — 튜닝 학습셋(≤2024-09-30)에서 3000회 손실 궤적
 *   E1: l2 × iters 튜닝 — 2024Q4 검증 분기 연승으로만 선택
 *   E2: PL 전체 / PL topK=3 — 같은 튜닝 절차
 *   판정: 6분기 롤링(2025Q1~2026Q2) 연승, 기준선 logistic l2=0.02·800회
 * 사용: npm run exp:learning   (⚠️ 선행 db:pull, 수십 분 소요 가능)
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { getActiveModelVersion } from '../src/engine/modelVersion.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import { fitPL } from '../src/engine/models/plackettLuce.js';
import { placeRate, verdict } from '../src/engine/eval/learningExp.js';
import type { ScorableModel } from '../src/engine/eval/score.js';
import type { RaceRecord } from '../src/engine/eval/types.js';

const L2S = [0.001, 0.005, 0.02, 0.05, 0.1];
const ITERS = [800, 3000];
type Variant = 'logistic' | 'pl' | 'pl-top3';

function train(v: Variant, races: RaceRecord[], schema: string[], l2: number, iters: number): ScorableModel {
  if (v === 'logistic') {
    const X = races.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
    const y = races.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
    return { kind: 'logistic', model: fitLogistic(X, y, schema, { l2, iters, lr: 0.2 }) };
  }
  const pr = races.map((r) => ({ horses: r.horses.map((h) => ({ x: toVector(h.features, schema), ord: h.ord })) }));
  return { kind: 'pl', model: fitPL(pr, schema, { l2, iters, lr: 0.2, ...(v === 'pl-top3' ? { topK: 3 } : {}) }), schema };
}

async function main() {
  const db = await getReadClient();
  const active = await getActiveModelVersion(db);
  const schema = active.artifact!.features;
  console.log(`스키마: 활성 ${active.label} 피처 ${schema.length}개`);
  const races = await collectRaces(db, 20220101, 20260630, { shapeParCutoff: 20250101 });
  console.log(`경주 ${races.length}`);

  const tuneTrain = races.filter((r) => r.raceDate <= 20240930);
  const tuneVal = races.filter((r) => r.raceDate >= 20241001 && r.raceDate <= 20241231);

  // E0 수렴
  const X0 = tuneTrain.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
  const y0 = tuneTrain.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
  const e0: [number, number][] = [];
  fitLogistic(X0, y0, schema, { l2: 0.02, iters: 3000, lr: 0.2, lossEvery: 200, onLoss: (it, l) => e0.push([it, l]) });
  console.log('\nE0 손실 궤적:', e0.map(([i, l]) => `${i}:${l.toFixed(5)}`).join(' '));

  // E1·E2 튜닝 (검증 분기만)
  const best: Record<Variant, { l2: number; iters: number; val: number }> = {} as never;
  for (const v of ['logistic', 'pl', 'pl-top3'] as Variant[]) {
    for (const l2 of L2S) for (const iters of ITERS) {
      const val = placeRate(train(v, tuneTrain, schema, l2, iters), tuneVal);
      console.log(`  튜닝 ${v} l2=${l2} iters=${iters} → 2024Q4 연승 ${(val * 100).toFixed(1)}%`);
      if (!best[v] || val > best[v].val) best[v] = { l2, iters, val };
    }
  }
  console.log('\n선택된 설정:', JSON.stringify(best));

  // 판정 — 6분기 롤링
  const blocks = rollingBlocks(races, { year: 2025, q: 1 });
  const series: Record<string, number[]> = { base: [], logistic: [], pl: [], 'pl-top3': [] };
  for (const b of blocks) {
    series.base!.push(placeRate(train('logistic', b.train, schema, 0.02, 800), b.test));
    for (const v of ['logistic', 'pl', 'pl-top3'] as Variant[]) series[v]!.push(placeRate(train(v, b.train, schema, best[v].l2, best[v].iters), b.test));
    console.log(`  ${b.key}: ` + Object.entries(series).map(([k, s]) => `${k} ${(s.at(-1)! * 100).toFixed(1)}%`).join(' · '));
  }
  const verdicts = Object.fromEntries((['logistic', 'pl', 'pl-top3'] as Variant[]).map((v) => [v, verdict(series.base!, series[v]!)]));
  for (const [v, r] of Object.entries(verdicts)) {
    console.log(`판정 ${v}(튜닝): 평균 Δ ${(r.meanDelta * 100).toFixed(2)}%p · 양수 ${r.positive}/${r.quarters} → ${r.pass ? '✅ 합격' : '❌ 불합격'}`);
  }
  const out = `data/exp_learning_${Date.now()}.json`;
  writeFileSync(out, JSON.stringify({ e0, best, quarters: blocks.map((b) => b.key), series, verdicts }, null, 2));
  console.log(`\n→ ${out}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
