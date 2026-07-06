/**
 * 알파 검증(비선형) — 오프셋 그래디언트 부스팅으로 선형이 못 잡은 상호작용 확인.
 * 모델 측면 마지막 카드. 프레임은 offsetClogit과 동일(offset=log market_prob, 경주내 softmax).
 *   시장(offset만, 1.786) vs 시장+부스팅. Δ<0 + CI<0 + 3컷오프 강건 = 첫 진짜 알파.
 * 과적합 방어: 얕은 트리(depth3)·early stopping·train/test Δ 격차 감시.
 * 사용: npm run probe:alpha:gbt -- [--drop earnings_asof] [--boot 1000] [--lr 0.05] [--depth 3]
 */
import { readFileSync } from 'node:fs';
import { buildSchema } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';
import { loadRaces, bootstrapRatio, clip, type Race } from '../src/engine/eval/offsetClogit.js';
import { fitOffsetGBT, predictMargin, type GBT } from '../src/engine/models/offsetGBT.js';

const f4 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(4);

/** 경주 리스트 → GBT 학습용 평탄 배열. */
function flatten(races: Race[]) {
  const X: number[][] = [], offset: number[] = [], groups: number[][] = [], winners: number[] = [];
  let row = 0;
  for (const r of races) {
    const g: number[] = [];
    for (let i = 0; i < r.x.length; i++) {
      X.push(r.x[i]!); offset.push(r.offset[i]!); g.push(row);
      if (i === r.winner) winners.push(row);
      row++;
    }
    groups.push(g);
  }
  return { X, offset: Float64Array.from(offset), groups, winners };
}

/** 테스트 경주 grouped-LL: margin = offset + 부스팅보정, 경주내 softmax, 승자 −log 평균. */
function testGroupedLL(races: Race[], gbt: GBT | null): { ll: number; perRaceWinLog: number[] } {
  const perRaceWinLog: number[] = [];
  let s = 0;
  for (const r of races) {
    const margin = r.x.map((xi, i) => r.offset[i]! + (gbt ? predictMargin(gbt, xi) : 0));
    const mx = Math.max(...margin);
    const ex = margin.map((m) => Math.exp(m - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    const pWin = ex[r.winner]! / sum;
    const wl = -Math.log(clip(pWin));
    perRaceWinLog.push(wl); s += wl;
  }
  return { ll: s / races.length, perRaceWinLog };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const boot = Number(arg('--boot', '1000'));
  const dropTokens = arg('--drop', '').split(',').map((s) => s.trim()).filter(Boolean);
  const isDropped = (name: string) => dropTokens.some((t) => name.includes(t));
  const gbtOpts = {
    rounds: 500, lr: Number(arg('--lr', '0.05')), maxDepth: Number(arg('--depth', '3')),
    lambda: 1.0, minChildWeight: 5, nBins: 32, valFrac: 0.15, patience: 25,
  };

  const allRows: { features: Feature[] }[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const keep = buildSchema(allRows.map((r) => r.features)).filter((n) => !isDropped(n));
  const { races, dropped } = loadRaces(matrixPath, keep);
  console.log(`경주 ${races.length}개 (제외 ${dropped}) · 피처 ${keep.length}개${dropTokens.length ? ' (drop)' : ''}`);
  console.log(`부스팅: depth ${gbtOpts.maxDepth} · lr ${gbtOpts.lr} · λ ${gbtOpts.lambda} · early-stop patience ${gbtOpts.patience} · 부트 ${boot}회\n`);

  console.log('='.repeat(84));
  console.log('컷오프     [시장]   [시장+부스팅]   testΔ       95% CI          rounds  trainΔ(과적합)  판정');
  console.log('-'.repeat(84));

  for (const cutoff of [20240901, 20250101, 20250401]) {
    const train = races.filter((r) => r.date < cutoff);
    const test = races.filter((r) => r.date >= cutoff);
    if (train.length < 100 || test.length < 100) { console.log(`${cutoff} 표본부족 skip`); continue; }

    const ft = flatten(train);
    const { gbt, bestRound, trainLL, valLL } = fitOffsetGBT(ft.X, ft.groups, ft.winners, ft.offset, gbtOpts);

    // 자체검증: 부스팅 없음(gbt=null) = 날배당 재현
    const mkt = testGroupedLL(test, null);
    const gb = testGroupedLL(test, gbt);
    const trainMkt = testGroupedLL(train, null).ll;
    const trainGb = testGroupedLL(train, gbt).ll;

    const perRace = test.map((_, i) => ({ num: gb.perRaceWinLog[i]! - mkt.perRaceWinLog[i]!, den: 1 }));
    const bs = bootstrapRatio(perRace, boot);
    const sig = bs.hi < 0 ? '✅유의(알파)' : bs.lo > 0 ? '❌악화' : '△0포함';
    const trainDelta = trainGb - trainMkt;
    const overfit = Math.abs(trainDelta - bs.mean) > 0.03 ? ` ⚠격차${f4(trainDelta - bs.mean)}` : '';

    console.log(`${cutoff}  ${mkt.ll.toFixed(4)}   ${gb.ll.toFixed(4)}      ${f4(bs.mean)}  [${f4(bs.lo)},${f4(bs.hi)}]  ${String(bestRound).padStart(4)}   ${f4(trainDelta)}${overfit}  ${sig}`);
    console.log(`           train ${train.length} / test ${test.length} · val-LL ${valLL[0]?.toFixed(4)}→${Math.min(...valLL).toFixed(4)} (${valLL.length}R)`);
  }
  console.log('='.repeat(84));
  console.log('testΔ<0 = 부스팅이 시장 이김(알파). trainΔ≪testΔ(격차 큼) = 과적합. 3컷오프 전부 CI<0 이어야 인정.');
}

main();
