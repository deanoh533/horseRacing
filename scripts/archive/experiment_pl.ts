/**
 * PL 하이퍼파라미터 튜닝 + 측정 (읽기전용).
 * train<split로 PL 학습, holdout>=split에서 1순위 픽 단/연승 채점. 그리드 스윕.
 * 로지스틱·시장 벤치마크 동시 출력. (PL의 홈그라운드=연승 랭킹)
 *
 * 사용: npm run exp:pl -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { fitPL, predictPL, type PLRace } from '../src/engine/models/plackettLuce.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; ord: number | null; top3: number; win_odds: number | null; features: Feature[]; }

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));

  const all: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);
  const schema = buildSchema(train.map((r) => r.features));
  console.log(`행렬 ${all.length} (train<${split} ${train.length} / test ${test.length}), 피처 ${schema.length}`);

  // 벡터 1회 precompute (그리드 전체 재사용)
  const trainVec = train.map((r) => toVector(r.features, schema));
  const testByRace = new Map<string, { vec: number[]; ord: number | null; win_odds: number | null }[]>();
  for (let i = 0; i < test.length; i++) {
    const r = test[i]!; const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!testByRace.has(k)) testByRace.set(k, []);
    testByRace.get(k)!.push({ vec: toVector(r.features, schema), ord: r.ord, win_odds: r.win_odds });
  }
  // PLRace (train, 경주별 ord)
  const trainRaceMap = new Map<string, { x: number[]; ord: number }[]>();
  for (let i = 0; i < train.length; i++) {
    const r = train[i]!; if (r.ord == null) continue;
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!trainRaceMap.has(k)) trainRaceMap.set(k, []);
    trainRaceMap.get(k)!.push({ x: trainVec[i]!, ord: r.ord });
  }
  const plRaces: PLRace[] = [...trainRaceMap.values()].filter((h) => h.length >= 2).map((h) => ({ horses: h }));

  // 채점: scorer로 1순위 픽 → 단승(1착)/연승(3착내)
  const evalTop = (scorer: (vec: number[]) => number) => {
    let win = 0, show = 0, n = 0;
    for (const horses of testByRace.values()) {
      const fin = horses.filter((h) => h.ord != null && h.ord <= 50);
      if (fin.length === 0) continue; n++;
      const top = [...fin].sort((a, b) => scorer(b.vec) - scorer(a.vec))[0]!;
      if (top.ord === 1) win++; if ((top.ord as number) <= 3) show++;
    }
    return { win: (win / n) * 100, show: (show / n) * 100, n };
  };
  const pct = (x: number) => x.toFixed(1);

  // 레퍼런스: 로지스틱(현행 설정) + 시장
  const logit = fitLogistic(trainVec, train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
  const logitR = evalTop((v) => predictLogit(logit, v));
  let mW = 0, mS = 0, mn = 0;
  for (const horses of testByRace.values()) {
    const fin = horses.filter((h) => h.ord != null && h.ord <= 50 && h.win_odds != null && h.win_odds! > 0);
    if (fin.length === 0) continue; mn++;
    const fav = [...fin].sort((a, b) => a.win_odds! - b.win_odds!)[0]!;
    if (fav.ord === 1) mW++; if ((fav.ord as number) <= 3) mS++;
  }

  // 그리드 스윕
  const grid: { l2: number; lr: number; iters: number }[] = [];
  for (const iters of [800, 2000, 4000]) for (const lr of [0.1, 0.3, 0.6]) for (const l2 of [0.02, 0.1]) grid.push({ l2, lr, iters });

  console.log(`\nPL 그리드 (단승 / 연승, n=${logitR.n}경주)`);
  console.log('iters | lr   | l2   | 단승  | 연승');
  console.log('-'.repeat(44));
  const results: { cfg: string; show: number; win: number }[] = [];
  for (const g of grid) {
    const m = fitPL(plRaces, schema, g);
    const r = evalTop((v) => predictPL(m, v));
    results.push({ cfg: `${g.iters}/${g.lr}/${g.l2}`, show: r.show, win: r.win });
    console.log(`${String(g.iters).padStart(5)} | ${String(g.lr).padEnd(4)} | ${String(g.l2).padEnd(4)} | ${pct(r.win).padStart(5)} | ${pct(r.show).padStart(5)}`);
  }
  console.log('-'.repeat(44));
  results.sort((a, b) => b.show - a.show);
  console.log(`\n★ PL 최고 연승: ${results[0]!.cfg} → 연승 ${pct(results[0]!.show)} / 단승 ${pct(results[0]!.win)}`);
  console.log(`  로지스틱(현행): 연승 ${pct(logitR.show)} / 단승 ${pct(logitR.win)}`);
  console.log(`  시장(인기1위): 연승 ${pct((mS / mn) * 100)} / 단승 ${pct((mW / mn) * 100)}`);
}
main();
