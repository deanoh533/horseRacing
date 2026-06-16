/**
 * 확률 재보정 효과 측정 — 원본 vs Platt vs Isotonic (롤링 OOS, 누수 0).
 * 보정자는 train fold로만 학습 → test fold에서 평가.
 * 사용: npm run calib:recal
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import {
  normalizeProbs, reliabilityBins, ece, brier, logLoss, sigmoid,
  fitPlatt, applyPlatt, fitIsotonic, applyIsotonic,
  type Pair,
} from '../src/engine/eval/calibration.js';

type Bucket = Record<string, Pair[]>;
const push = (b: Bucket, key: string, pair: Pair): void => {
  (b[key] ??= []).push(pair);
};

function metricsRow(label: string, pairs: Pair[]): string {
  const f3 = (x: number) => x.toFixed(3);
  const e = ece(reliabilityBins(pairs, 10));
  return `${label.padEnd(20)} ${f3(e).padStart(7)} ${f3(brier(pairs)).padStart(7)} ${f3(logLoss(pairs)).padStart(8)}`;
}

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('📊 확률 재보정 효과 (Platt/Isotonic, 롤링 OOS)\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const blocks = rollingBlocks(races, { year: 2025, q: 1 });
  const win: Bucket = {};
  const top3: Bucket = {};
  const market: Pair[] = [];
  const cfg = { l2: 0.02, iters: 800, lr: 0.2 };

  for (const block of blocks) {
    const schema = buildSchema(block.train.flatMap((r) => r.horses.map((h) => h.features)))
      .filter((n) => !n.endsWith('__missing'));
    const X = block.train.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
    const y1 = block.train.flatMap((r) => r.horses.map((h) => (h.ord === 1 ? 1 : 0)));
    const y3 = block.train.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
    const p1 = fitLogistic(X, y1, schema, cfg);
    const p3 = fitLogistic(X, y3, schema, cfg);

    const trainP1: Pair[] = [];
    for (const r of block.train) {
      const norm = normalizeProbs(r.horses.map((h) => sigmoid(predictLogit(p1, toVector(h.features, schema)))));
      r.horses.forEach((h, i) => trainP1.push({ p: norm[i]!, y: h.ord === 1 ? 1 : 0 }));
    }
    const trainP3: Pair[] = block.train.flatMap((r) =>
      r.horses.map((h) => ({ p: sigmoid(predictLogit(p3, toVector(h.features, schema))), y: h.ord <= 3 ? 1 : 0 })));
    const calP1Platt = fitPlatt(trainP1);
    const calP1Iso = fitIsotonic(trainP1);
    const calP3Platt = fitPlatt(trainP3);
    const calP3Iso = fitIsotonic(trainP3);

    for (const race of block.test) {
      const hs = race.horses;
      const normWin = normalizeProbs(hs.map((h) => sigmoid(predictLogit(p1, toVector(h.features, schema)))));
      const plattVals = normWin.map((p) => applyPlatt(calP1Platt, p));
      const isoVals = normWin.map((p) => applyIsotonic(calP1Iso, p));
      const plattRe = normalizeProbs(plattVals);
      const isoRe = normalizeProbs(isoVals);
      hs.forEach((h, i) => {
        const y = h.ord === 1 ? 1 : 0;
        push(win, '원본', { p: normWin[i]!, y });
        push(win, 'Platt', { p: plattVals[i]!, y });
        push(win, 'Isotonic', { p: isoVals[i]!, y });
        push(win, 'Platt(+재정규화)', { p: plattRe[i]!, y });
        push(win, 'Isotonic(+재정규화)', { p: isoRe[i]!, y });
      });
      hs.forEach((h) => {
        const raw = sigmoid(predictLogit(p3, toVector(h.features, schema)));
        const y = h.ord <= 3 ? 1 : 0;
        push(top3, '원본', { p: raw, y });
        push(top3, 'Platt', { p: applyPlatt(calP3Platt, raw), y });
        push(top3, 'Isotonic', { p: applyIsotonic(calP3Iso, raw), y });
      });
      const withOdds = hs.filter((h) => h.winOdds != null && h.winOdds > 0);
      const normMkt = normalizeProbs(withOdds.map((h) => 1 / (h.winOdds as number)));
      withOdds.forEach((h, i) => market.push({ p: normMkt[i]!, y: h.ord === 1 ? 1 : 0 }));
    }
  }

  console.log(`\nOOS 분기: ${blocks.map((b) => b.key).join(', ')}`);
  console.log(`표본: P1 ${win['원본']!.length}말 / 시장 ${market.length}말\n`);

  const header = `${'방법'.padEnd(20)} ${'ECE'.padStart(7)} ${'Brier'.padStart(7)} ${'log-loss'.padStart(8)}`;
  console.log('=== 재보정 효과: P(1착) (롤링 OOS) ===');
  console.log(header);
  for (const k of ['원본', 'Platt', 'Isotonic', 'Platt(+재정규화)', 'Isotonic(+재정규화)']) {
    console.log(metricsRow(k, win[k]!));
  }
  console.log(metricsRow('시장(참고)', market));

  console.log('\n=== 재보정 효과: P(3착내) ===');
  console.log(header);
  for (const k of ['원본', 'Platt', 'Isotonic']) console.log(metricsRow(k, top3[k]!));
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
