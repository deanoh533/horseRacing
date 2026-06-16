/**
 * 캘리브레이션 평가축 — 모델 확률 정직성 vs 시장 (롤링 OOS).
 * 사용: npm run calib
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import {
  normalizeProbs, reliabilityBins, ece, formatCalibration, sigmoid,
  type Pair, type CalibrationReport,
} from '../src/engine/eval/calibration.js';

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('📊 캘리브레이션 평가축\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const blocks = rollingBlocks(races, { year: 2025, q: 1 });
  const modelWin: Pair[] = [];
  const marketWin: Pair[] = [];
  const modelTop3: Pair[] = [];
  const perQ = new Map<string, { mw: Pair[]; kw: Pair[] }>();
  const cfg = { l2: 0.02, iters: 800, lr: 0.2 };

  for (const block of blocks) {
    const schema = buildSchema(block.train.flatMap((r) => r.horses.map((h) => h.features)))
      .filter((n) => !n.endsWith('__missing'));
    const X = block.train.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
    const y1 = block.train.flatMap((r) => r.horses.map((h) => (h.ord === 1 ? 1 : 0)));
    const y3 = block.train.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
    const p1 = fitLogistic(X, y1, schema, cfg);
    const p3 = fitLogistic(X, y3, schema, cfg);

    if (!perQ.has(block.key)) perQ.set(block.key, { mw: [], kw: [] });
    const q = perQ.get(block.key)!;

    for (const race of block.test) {
      const horses = race.horses;
      // predictLogit은 logit 반환 → sigmoid로 확률화. P(1착)은 경주내 정규화(합=1).
      const rawWin = horses.map((h) => sigmoid(predictLogit(p1, toVector(h.features, schema))));
      const normWin = normalizeProbs(rawWin);
      horses.forEach((h, i) => {
        const pair: Pair = { p: normWin[i]!, y: h.ord === 1 ? 1 : 0 };
        modelWin.push(pair); q.mw.push(pair);
        modelTop3.push({ p: sigmoid(predictLogit(p3, toVector(h.features, schema))), y: h.ord <= 3 ? 1 : 0 });
      });
      const withOdds = horses.filter((h) => h.winOdds != null && h.winOdds > 0);
      const rawMkt = withOdds.map((h) => 1 / (h.winOdds as number));
      const normMkt = normalizeProbs(rawMkt);
      withOdds.forEach((h, i) => {
        const pair: Pair = { p: normMkt[i]!, y: h.ord === 1 ? 1 : 0 };
        marketWin.push(pair); q.kw.push(pair);
      });
    }
  }

  const eceOf = (pairs: Pair[]) => ece(reliabilityBins(pairs, 10));
  const perQuarter = [...perQ.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, modelEce: eceOf(v.mw), marketEce: eceOf(v.kw) }));

  const report: CalibrationReport = { modelWin, marketWin, modelTop3, perQuarter };
  console.log(`\nOOS 분기: ${blocks.map((b) => b.key).join(', ')}`);
  console.log(`표본: 모델 ${modelWin.length}말 / 시장 ${marketWin.length}말\n`);
  console.log(formatCalibration(report));
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
