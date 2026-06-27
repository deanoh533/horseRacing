// scripts/probe_picks_oos.ts
/**
 * 선별(강추/주목) OOS 재검증 — predictions 테이블의 p_top3가 in-sample(사후 backfill·미래 누수)이라
 * probe:picks가 보고한 강추 73%가 진짜 holdout 성적인지 walk-forward로 다시 잰다. 읽기전용.
 *
 * 절차(프로덕션 산식 동일):
 *   1) base 로지스틱 = train(race_date<split)에서 top3 학습
 *   2) Platt(platt3) = train에서 {raw P(top3), top3}로 적합  ← 보정도 train에서만
 *   3) test에 적용 → OOS p_top3 = applyPlatt(platt3, sigmoid(base logit))
 *   4) 같은 임계값(config)·같은 정의(연승=ord≤3)로 tierAccuracy 측정
 * 비교 기준 = probe:picks(in-sample, predictions 테이블): 강추 73.1% / 주목 65.4% / 베이스 28.4%.
 *
 * 사용: npm run probe:picks:oos [-- --split 20250101 --matrix data/training_matrix.jsonl]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { sigmoid, fitPlatt, applyPlatt, type Pair } from '../src/engine/eval/calibration.js';
import { tierAccuracy, buildSelectionCurve, type PredRow } from '../src/engine/eval/selectivePicks.js';
import type { Feature } from '../src/engine/features/types.js';

const CONFIG_PATH = 'client/src/config/selective_picks.json';
const pct = (x: number): string => (x * 100).toFixed(1) + '%';
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d; };

interface MRow { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; top3: number; features: Feature[]; }

function main(): void {
  const split = Number(arg('--split', '20250101'));
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const sMin: number = cfg.tiers.strong.minProb;
  const wMin: number = cfg.tiers.watch.minProb;

  const all: MRow[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);

  // 1) base 로지스틱 (top3) — train
  const schema = buildSchema(train.map((r) => r.features));
  const base = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
  const rawProb = (r: MRow): number => sigmoid(predictLogit(base, toVector(r.features, schema)));

  // 2) Platt(platt3) — train의 {raw, top3}
  const platt3 = fitPlatt(train.map((r): Pair => ({ p: rawProb(r), y: r.top3 })));

  // 3) OOS / IN p_top3 → PredRow
  const toPred = (r: MRow): PredRow => ({
    race_date: r.race_date, meet: r.meet, rc_no: r.rc_no,
    p_top3: applyPlatt(platt3, rawProb(r)), p_win: null, actual_ord: r.ord,
  });
  const oosRows = test.map(toPred);
  const inRows = train.map(toPred);

  console.log(`📊 선별 OOS 재검증 — split ${split} · train ${train.length}행 / test ${test.length}행`);
  console.log(`   임계값 강추≥${sMin} · 주목≥${wMin} · 연승=ord≤3(공식 정의) · 단일 split(과거→미래)`);
  console.log('   비교기준(in-sample, predictions): 강추 73.1% · 주목 65.4% · 베이스 28.4%\n');

  const report = (label: string, rows: PredRow[]): void => {
    const curve = buildSelectionCurve(rows, []);
    const [strong, watch] = tierAccuracy(rows, sMin, wMin);
    console.log(`── ${label} (베이스 연승 ${pct(curve.baselinePlace)}) ──`);
    console.log('  티어 | 건수  | 연승(ord≤3) | 단승 | 커버리지');
    for (const s of [strong!, watch!]) {
      const name = s.tier === 'strong' ? '강추' : '주목';
      console.log(`  ${name} | ${String(s.picks).padStart(5)} | ${pct(s.placeHitRate).padStart(11)} | ${pct(s.winHitRate).padStart(5)} | ${pct(s.coverage)}`);
    }
  };

  report('IN-SAMPLE (train→train, 누수 재현)', inRows);
  console.log('');
  report('OOS (train→test, 정직)', oosRows);

  // OOS 임계값 곡선 — 같은 threshold가 OOS에서 주는 실제 적중률
  const grid: number[] = [];
  for (let t = 0.55; t <= 0.8 + 1e-9; t += 0.05) grid.push(Number(t.toFixed(2)));
  const oosCurve = buildSelectionCurve(oosRows, grid);
  console.log('\n── OOS 임계값 곡선 ──');
  console.log('p_top3 ≥ | 건수 | 연승(ord≤3) | 커버리지');
  for (const p of [...oosCurve.points].sort((a, b) => b.threshold - a.threshold)) {
    console.log(`  ${p.threshold.toFixed(2)}   | ${String(p.picks).padStart(4)} | ${pct(p.placeHitRate).padStart(11)} | ${pct(p.coverage)}`);
  }
  console.log('\n판정: OOS 강추 연승이 in-sample 73%보다 크게 낮으면 → 보고 수치 부풀림. config 임계값/문구 재조정 검토.');
}

main();
