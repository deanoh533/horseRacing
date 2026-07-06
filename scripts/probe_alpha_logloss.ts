/**
 * 알파 검증(총량) — 오프셋 조건부 로지트로 "시장 vs 시장+피처" 직접 대결.
 *   β=0 = 날배당 log-loss 정확 재현(자체검증). Δ=(시장+피처)−시장 <0 이면 알파.
 *   유의성: 경주블록 부트스트랩 95% CI. 강건성: 컷오프 이동.
 * 오프라인: data/training_matrix.jsonl만 읽음.
 * 사용: npm run probe:alpha -- [--drop earnings_asof] [--boot 1000] [--l2 0.02]
 */
import { readFileSync } from 'node:fs';
import { buildSchema } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';
import {
  loadRaces, standardizer, fitOffsetCLogit, raceProbs, groupedLL, bootstrapRatio, clip, type Race,
} from '../src/engine/eval/offsetClogit.js';

function runAtCutoff(races: Race[], cutoff: number, opts: { l2: number; iters: number; lr: number }, boot: number) {
  const train = races.filter((r) => r.date < cutoff);
  const test = races.filter((r) => r.date >= cutoff);
  if (train.length < 50 || test.length < 50) return null;
  const d = races[0]!.x[0]!.length;
  const { mean, std } = standardizer(train, d);
  const beta = fitOffsetCLogit(train, mean, std, opts);
  const zero = new Array(d).fill(0);
  const llMarket = groupedLL(test, zero, mean, std);
  const llMF = groupedLL(test, beta, mean, std);
  const perRace = test.map((r) => {
    const wl = (b: number[]) => -Math.log(clip(raceProbs(r, b, mean, std)[r.winner]!));
    return { num: wl(beta) - wl(zero), den: 1 };
  });
  const bs = bootstrapRatio(perRace, boot);
  return { trainN: train.length, testN: test.length, llMarket, llMF, bs, beta, mean, std };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const boot = Number(arg('--boot', '1000'));
  const dropTokens = arg('--drop', '').split(',').map((s) => s.trim()).filter(Boolean);
  const isDropped = (name: string) => dropTokens.some((t) => name.includes(t));
  const opts = { l2: Number(arg('--l2', '0.02')), iters: 1200, lr: 0.5 };

  const allRows: { features: Feature[] }[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const keep = buildSchema(allRows.map((r) => r.features)).filter((n) => !isDropped(n));
  const { races, dropped } = loadRaces(matrixPath, keep);
  console.log(`경주 ${races.length}개 (제외 ${dropped}) · 피처 ${keep.length}개${dropTokens.length ? ` (drop: ${dropTokens.join(',')})` : ''} · 부트스트랩 ${boot}회\n`);

  // 자체검증: β=0 = 날배당 로그로스
  const d0 = races[0]!.x[0]!.length;
  const { mean: m0, std: s0 } = standardizer(races, d0);
  const llZero = groupedLL(races, new Array(d0).fill(0), m0, s0);
  const llRaw = races.reduce((s, r) => s - Math.log(clip(r.marketProb[r.winner]!)), 0) / races.length;
  if (Math.abs(llZero - llRaw) > 1e-9) throw new Error(`오프셋 검증 실패: ${llZero} ≠ ${llRaw}`);
  console.log(`✅ 오프셋 검증: β=0 log-loss = 날배당 log-loss = ${llRaw.toFixed(4)} (일치)\n`);

  console.log('='.repeat(72));
  console.log('컷오프     [시장]   [시장+피처]   Δ(피처−시장)      95% CI          판정');
  console.log('-'.repeat(72));
  let mainRun: ReturnType<typeof runAtCutoff> = null;
  for (const cutoff of [20240901, 20250101, 20250401]) {
    const r = runAtCutoff(races, cutoff, opts, boot);
    if (!r) { console.log(`${cutoff}  (표본부족 skip)`); continue; }
    if (cutoff === 20250101) mainRun = r;
    const sig = r.bs.hi < 0 ? '✅ 유의(알파)' : r.bs.lo > 0 ? '❌ 악화' : '△ 불확실(0포함)';
    const f = (x: number) => x.toFixed(4);
    console.log(`${cutoff}  ${f(r.llMarket)}   ${f(r.llMF)}     ${r.bs.mean >= 0 ? '+' : ''}${f(r.bs.mean)}   [${f(r.bs.lo)}, ${f(r.bs.hi)}]  ${sig}`);
    console.log(`           train ${r.trainN} / test ${r.testN}`);
  }
  console.log('='.repeat(72));
  console.log('Δ<0 = 시장+피처가 날배당보다 나음(알파). CI 전부 <0 이면 노이즈 아님.');

  if (mainRun) {
    console.log('\n[20250101 컷오프 · β |상위 12| — 시장 오프셋 위 순수 기여]');
    keep.map((name, k) => [name, mainRun!.beta[k]!] as [string, number])
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 12)
      .forEach(([k, v]) => console.log(`  ${v >= 0 ? '+' : ''}${v.toFixed(3)}  ${k}`));
  }
}

main();
