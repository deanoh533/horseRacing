/**
 * 배당 블렌드 × 선별표시·캘리브레이션 검증 (채택 전 확인).
 *   모델(피처만·현행) vs 블렌드(피처+log시장확률) vs 시장(배당만), 라벨=top3.
 *   ① 캘리브레이션: Platt 보정 후 P(top3) ECE·Brier·log-loss (모델 vs 블렌드)
 *   ② 선별표시 커버리지매칭: 상위 5/10/20% 픽의 연승률(ord≤3) + 픽수 (모델/블렌드/시장)
 *   ③ 배포 임계값: 강추(≥.72)/주목(≥.62) 커버리지·연승률 (모델 vs 블렌드)
 *   3컷오프 walk-forward = OOS 재현 확인.
 * 오프라인: data/training_matrix.jsonl. 사용: npm run probe:blend:picks
 */
import { readFileSync } from 'node:fs';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { sigmoid, fitPlatt, applyPlatt, ece, brier, logLoss, reliabilityBins, type Pair } from '../src/engine/eval/calibration.js';
import type { Feature } from '../src/engine/features/types.js';

interface Horse { x: number[]; xb: number[]; mktProb: number; top3: number; }
interface Race { date: number; horses: Horse[]; }
interface Row { race_date: number; meet: number; rc_no: number; ord: number | null; win_odds: number | null; features: Feature[]; }

const CUTOFFS = [20240901, 20250101, 20250401];
const pct = (x: number) => (x * 100).toFixed(1) + '%';

function loadRaces(path: string, schema: string[]): Race[] {
  const rows: Row[] = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const byRace = new Map<string, Row[]>();
  for (const r of rows) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; (byRace.get(k) ?? byRace.set(k, []).get(k)!).push(r); }
  const races: Race[] = [];
  for (const [, rs] of byRace) {
    if (rs.length < 3 || rs.some((r) => r.win_odds == null || r.win_odds <= 0 || r.ord == null)) continue;
    const inv = rs.map((r) => 1 / r.win_odds!);
    const sum = inv.reduce((a, b) => a + b, 0);
    const horses = rs.map((r, i) => {
      const x = toVector(r.features, schema); const mp = inv[i]! / sum;
      return { x, xb: [...x, Math.log(mp)], mktProb: mp, top3: r.ord! <= 3 ? 1 : 0 };
    });
    races.push({ date: rs[0]!.race_date, horses });
  }
  return races;
}

/** 커버리지매칭: score 내림차순 상위 cov 비율 픽의 연승률·픽수. */
function coverageHit(items: { score: number; top3: number }[], cov: number) {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const k = Math.max(1, Math.floor(items.length * cov));
  const pick = sorted.slice(0, k);
  return { rate: pick.reduce((s, p) => s + p.top3, 0) / k, n: k };
}

/** 임계값 이상 픽의 연승률·픽수. */
function thresholdHit(items: { p: number; top3: number }[], t: number) {
  const pick = items.filter((it) => it.p >= t);
  return { rate: pick.length ? pick.reduce((s, p) => s + p.top3, 0) / pick.length : NaN, n: pick.length };
}

function main() {
  const matrixPath = 'data/training_matrix.jsonl';
  const allRows: { features: Feature[] }[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const schema = buildSchema(allRows.map((r) => r.features));
  const blendSchema = [...schema, '__log_market_prob'];
  const races = loadRaces(matrixPath, schema);
  console.log(`경주 ${races.length}개 · 피처 ${schema.length} (top3 기저율 ${pct(races.flatMap((r) => r.horses).reduce((s, h) => s + h.top3, 0) / races.flatMap((r) => r.horses).length)})\n`);

  for (const cutoff of CUTOFFS) {
    const train = races.filter((r) => r.date < cutoff);
    const test = races.filter((r) => r.date >= cutoff);
    if (train.length < 100 || test.length < 100) { console.log(`${cutoff} skip`); continue; }
    const trH = train.flatMap((r) => r.horses), teH = test.flatMap((r) => r.horses);

    const mModel = fitLogistic(trH.map((h) => h.x), trH.map((h) => h.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
    const mBlend = fitLogistic(trH.map((h) => h.xb), trH.map((h) => h.top3), blendSchema, { l2: 0.02, iters: 800, lr: 0.2 });

    // Platt: train raw sigmoid(logit) → 보정
    const plModel = fitPlatt(trH.map((h) => ({ p: sigmoid(predictLogit(mModel, h.x)), y: h.top3 })));
    const plBlend = fitPlatt(trH.map((h) => ({ p: sigmoid(predictLogit(mBlend, h.xb)), y: h.top3 })));

    const modelP = teH.map((h) => ({ p: applyPlatt(plModel, sigmoid(predictLogit(mModel, h.x))), top3: h.top3, mkt: h.mktProb }));
    const blendP = teH.map((h) => ({ p: applyPlatt(plBlend, sigmoid(predictLogit(mBlend, h.xb))), top3: h.top3, mkt: h.mktProb }));

    const pairsM: Pair[] = modelP.map((r) => ({ p: r.p, y: r.top3 }));
    const pairsB: Pair[] = blendP.map((r) => ({ p: r.p, y: r.top3 }));

    console.log(`━━ 컷오프 ${cutoff}  (train ${train.length} / test ${test.length}, 픽후보 ${teH.length}마리) ━━`);
    console.log('① 캘리브레이션 P(top3)     ECE      Brier    log-loss');
    console.log(`   모델(현행)            ${ece(reliabilityBins(pairsM)).toFixed(4)}   ${brier(pairsM).toFixed(4)}   ${logLoss(pairsM).toFixed(4)}`);
    console.log(`   블렌드                ${ece(reliabilityBins(pairsB)).toFixed(4)}   ${brier(pairsB).toFixed(4)}   ${logLoss(pairsB).toFixed(4)}`);

    console.log('② 선별표시 커버리지매칭 (상위 X% 픽 연승률)');
    console.log('   커버리지   모델      블렌드    시장');
    for (const cov of [0.05, 0.10, 0.20]) {
      const m = coverageHit(modelP.map((r) => ({ score: r.p, top3: r.top3 })), cov);
      const b = coverageHit(blendP.map((r) => ({ score: r.p, top3: r.top3 })), cov);
      const k = coverageHit(modelP.map((r) => ({ score: r.mkt, top3: r.top3 })), cov);
      console.log(`   상위 ${(cov * 100).toFixed(0).padStart(2)}%(${String(m.n).padStart(4)})  ${pct(m.rate).padStart(6)}   ${pct(b.rate).padStart(6)}   ${pct(k.rate).padStart(6)}`);
    }

    console.log('③ 배포 임계값 (Platt P(top3))     모델            블렌드');
    for (const [name, t] of [['강추 ≥.72', 0.72], ['주목 ≥.62', 0.62]] as [string, number][]) {
      const m = thresholdHit(modelP, t); const b = thresholdHit(blendP, t);
      const cell = (h: { rate: number; n: number }) => `${isNaN(h.rate) ? '  -  ' : pct(h.rate).padStart(6)}(${String(h.n).padStart(4)}픽)`;
      console.log(`   ${name}                   ${cell(m)}   ${cell(b)}`);
    }
    console.log();
  }
  console.log('판정: 블렌드가 ①ECE 낮고 ②동일커버리지 연승률↑ ③임계값 픽수·연승률↑ 이면 선별표시도 개선.');
}

main();
