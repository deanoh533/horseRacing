/**
 * 배당 블렌드 — 오늘 배당을 재료로 넣으면 "연승 적중률"이 오르나? (알파 아님, 적중률)
 *   모델(피처만·현행) vs 시장(배당만) vs 블렌드(피처+log시장확률 재학습).
 *   지표: ①1픽 연승률(최상위 예측마 ord≤3) ②1픽 단승률 ③예측top3∩실제top3 교집합.
 *   시간순 분할 + 경주블록 부트스트랩(블렌드−모델, 블렌드−시장).
 * 오프라인: data/training_matrix.jsonl (win_odds·ord 포함). 사용: npm run probe:blend
 */
import { readFileSync } from 'node:fs';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit, type LogisticModel } from '../src/engine/models/logistic.js';
import { bootstrapRatio } from '../src/engine/eval/offsetClogit.js';
import type { Feature } from '../src/engine/features/types.js';

interface Horse { x: number[]; mktProb: number; logMkt: number; ord: number; }
interface Race { date: number; horses: Horse[]; }
interface Row { race_date: number; meet: number; rc_no: number; ord: number | null; win_odds: number | null; features: Feature[]; }

const CUTOFFS = [20240901, 20250101, 20250401];
const f3 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3);

/** 학습행렬 → 경주별. 전 출주마 win_odds>0 & ord 유효 & ≥3두 인 경주만. */
function loadRaces(path: string, schema: string[]): Race[] {
  const rows: Row[] = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const byRace = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    (byRace.get(k) ?? byRace.set(k, []).get(k)!).push(r);
  }
  const races: Race[] = [];
  for (const [, rs] of byRace) {
    if (rs.length < 3) continue;
    if (rs.some((r) => r.win_odds == null || r.win_odds <= 0 || r.ord == null)) continue;
    const inv = rs.map((r) => 1 / r.win_odds!);
    const sum = inv.reduce((a, b) => a + b, 0);
    const horses: Horse[] = rs.map((r, i) => {
      const mp = inv[i]! / sum;
      return { x: toVector(r.features, schema), mktProb: mp, logMkt: Math.log(mp), ord: r.ord! };
    });
    if (!horses.some((h) => h.ord === 1)) continue;
    races.push({ date: rs[0]!.race_date, horses });
  }
  return races;
}

/** 경주 순위(점수 내림차순) → 지표. score(h)=클수록 상위. */
function rankMetrics(races: Race[], score: (h: Horse) => number) {
  const per = races.map((r) => {
    const sorted = [...r.horses].sort((a, b) => score(b) - score(a));
    const top1 = sorted[0]!;
    const pred3 = new Set(sorted.slice(0, 3));
    let overlap = 0;
    for (const h of pred3) if (h.ord <= 3) overlap++;
    return { place: top1.ord <= 3 ? 1 : 0, win: top1.ord === 1 ? 1 : 0, overlap: overlap / 3 };
  });
  const mean = (k: 'place' | 'win' | 'overlap') => per.reduce((s, p) => s + p[k], 0) / per.length;
  return { place: mean('place'), win: mean('win'), overlap: mean('overlap'), per };
}

function main() {
  const args = process.argv.slice(2);
  const matrixPath = args.indexOf('--matrix') >= 0 ? args[args.indexOf('--matrix') + 1]! : 'data/training_matrix.jsonl';
  const boot = Number(args.indexOf('--boot') >= 0 ? args[args.indexOf('--boot') + 1]! : 1000);

  const allRows: { features: Feature[] }[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const schema = buildSchema(allRows.map((r) => r.features));
  const races = loadRaces(matrixPath, schema);
  console.log(`경주 ${races.length}개 · 피처 ${schema.length} · 부트 ${boot}회`);
  console.log('적중률 = 최상위 예측마가 실제 3착내 든 경주 비율. 시장=천장.\n');

  const blendSchema = [...schema, '__log_market_prob'];

  for (const cutoff of CUTOFFS) {
    const train = races.filter((r) => r.date < cutoff);
    const test = races.filter((r) => r.date >= cutoff);
    if (train.length < 100 || test.length < 100) { console.log(`${cutoff} 표본부족 skip`); continue; }

    // 학습행: 말단위 (top3 라벨)
    const trX: number[][] = [], trY: number[] = [], trXb: number[][] = [];
    for (const r of train) for (const h of r.horses) {
      trX.push(h.x); trXb.push([...h.x, h.logMkt]); trY.push(h.ord <= 3 ? 1 : 0);
    }
    const mModel: LogisticModel = fitLogistic(trX, trY, schema, { l2: 0.02, iters: 800, lr: 0.2 });
    const mBlend: LogisticModel = fitLogistic(trXb, trY, blendSchema, { l2: 0.02, iters: 800, lr: 0.2 });

    const model = rankMetrics(test, (h) => predictLogit(mModel, h.x));
    const market = rankMetrics(test, (h) => h.mktProb);
    const blend = rankMetrics(test, (h) => predictLogit(mBlend, [...h.x, h.logMkt]));

    // 부트스트랩: 블렌드−모델, 블렌드−시장 (1픽 연승률 차)
    const bVm = bootstrapRatio(test.map((_, i) => ({ num: blend.per[i]!.place - model.per[i]!.place, den: 1 })), boot);
    const bVk = bootstrapRatio(test.map((_, i) => ({ num: blend.per[i]!.place - market.per[i]!.place, den: 1 })), boot);

    console.log(`━━ 컷오프 ${cutoff}  (train ${train.length} / test ${test.length}) ━━`);
    console.log('              1픽연승률   1픽단승률   top3교집합');
    const pct = (x: number) => (x * 100).toFixed(1).padStart(5) + '%';
    console.log(`  모델(현행)   ${pct(model.place)}     ${pct(model.win)}     ${pct(model.overlap)}`);
    console.log(`  시장(천장)   ${pct(market.place)}     ${pct(market.win)}     ${pct(market.overlap)}`);
    console.log(`  블렌드       ${pct(blend.place)}     ${pct(blend.win)}     ${pct(blend.overlap)}`);
    console.log(`  Δ 블렌드−모델 = ${f3(bVm.mean)} [${f3(bVm.lo)},${f3(bVm.hi)}]  ${bVm.lo > 0 ? '✅적중률↑' : bVm.hi < 0 ? '❌↓' : '△0포함'}`);
    console.log(`  Δ 블렌드−시장 = ${f3(bVk.mean)} [${f3(bVk.lo)},${f3(bVk.hi)}]  ${bVk.lo > 0 ? '✅시장초과' : bVk.hi < 0 ? '❌시장미달' : '△시장≈'}\n`);
  }
  console.log('해석: 블렌드−모델>0 = 배당 넣으면 적중률↑(우리쪽 이득). 블렌드−시장≈0 = 시장 천장 도달(초과는 아님).');
}

main();
