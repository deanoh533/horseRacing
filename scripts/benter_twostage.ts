/**
 * Benter 2단계 합성 — 모델이 시장 위에 직교정보를 더하나.
 * 사용: npm run benter
 * 판정: b가 분기 걸쳐 >0 AND 합성 NLL < 시장 NLL = 정보 기여(돌파).
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { sigmoid, normalizeProbs } from '../src/engine/eval/calibration.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { predictLogit } from '../src/engine/models/logistic.js';
import { predictGBDT } from '../src/engine/models/gbdt.js';
import { predictPL } from '../src/engine/models/plackettLuce.js';
import {
  marketProbsFromOdds, combinedProbs, fitBenter, winNLL, pickStats, softmax,
} from '../src/engine/eval/benter.js';
import type { BenterRace } from '../src/engine/eval/benter.js';
import type { HorseRecord, RaceRecord } from '../src/engine/eval/types.js';

const FIRST_TEST = { year: 2025, q: 1 };

type ModelProbFn = (horses: HorseRecord[]) => number[];

function toBenterRace(race: RaceRecord, modelProb: ModelProbFn): BenterRace | null {
  const subset = race.horses.filter((h) => h.winOdds != null && h.winOdds > 0);
  if (subset.length < 3) return null;
  const winnerIdx = subset.findIndex((h) => h.ord === 1);
  if (winnerIdx < 0) return null;
  return {
    marketProb: marketProbsFromOdds(subset.map((h) => h.winOdds as number)),
    modelProb: modelProb(subset),
    ords: subset.map((h) => h.ord),
    winnerIdx,
  };
}

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('Benter 2단계 — 데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  if (races.length === 0) {
    console.log('\n데이터 없음 — npm run db:pull 로 DuckDB 미러를 채운 뒤 실행하세요.');
    return;
  }

  const approved = new Set(races.flatMap((r) => r.horses.flatMap((h) => Object.keys(h.rawScores))));

  const blocks = rollingBlocks(races, FIRST_TEST);

  if (blocks.length === 0) {
    console.log('\n테스트 블록 없음 — 2025-Q1 이후 데이터가 필요합니다.');
    return;
  }

  const MODELS = ['Logistic(t1)', 'GBDT(t1)', 'PL'] as const;
  type ModelName = typeof MODELS[number];

  type Acc = { test: BenterRace[]; combo: number[][]; bTrend: { key: string; a: number; b: number }[] };
  const acc = new Map<ModelName, Acc>(MODELS.map((m) => [m, { test: [], combo: [], bTrend: [] }]));

  for (const block of blocks) {
    console.log(`  [${block.key}] train=${block.train.length} test=${block.test.length} 학습중...`);
    const tm = trainAllModels(block.train, approved);
    const schema = tm.featureSchema;
    const probFns: Record<ModelName, ModelProbFn> = {
      'Logistic(t1)': (hs) => normalizeProbs(hs.map((h) => sigmoid(predictLogit(tm.logisticTop1, toVector(h.features, schema))))),
      'GBDT(t1)': (hs) => normalizeProbs(hs.map((h) => sigmoid(predictGBDT(tm.gbdtTop1, toVector(h.features, schema))))),
      'PL': (hs) => softmax(hs.map((h) => predictPL(tm.pl, toVector(h.features, schema)))),
    };

    for (const m of MODELS) {
      const fn = probFns[m];
      const trainBR = block.train.map((r) => toBenterRace(r, fn)).filter((x): x is BenterRace => x !== null);
      // 2-파라미터 오목 GLM이라 수백 iter면 수렴. 3000은 과함 → 800.
      const { a, b } = fitBenter(trainBR, { iters: 800 });
      acc.get(m)!.bTrend.push({ key: block.key, a, b });
      for (const r of block.test) {
        const br = toBenterRace(r, fn);
        if (!br) continue;
        acc.get(m)!.test.push(br);
        acc.get(m)!.combo.push(combinedProbs(a, b, br.marketProb, br.modelProb));
      }
    }
  }

  const pct = (a: number, n: number) => (n ? ((a / n) * 100).toFixed(1) : '-');
  console.log('\n' + '='.repeat(72));
  console.log('Benter 2단계 — 모델이 시장 위에 직교정보를 더하나 (OOS 풀링)');
  console.log('='.repeat(72));
  for (const m of MODELS) {
    const A = acc.get(m)!;

    if (A.test.length === 0) {
      console.log(`\n[${m}]  테스트 레이스 없음`);
      continue;
    }

    const nllMkt = winNLL(A.test, (r) => r.marketProb);
    const nllMod = winNLL(A.test, (r) => r.modelProb);

    let nllComboSum = 0;
    for (let i = 0; i < A.test.length; i++) {
      nllComboSum += -Math.log(Math.max(A.combo[i]![A.test[i]!.winnerIdx]!, 1e-12));
    }
    const nllCombo = nllComboSum / A.test.length;

    const sMkt = pickStats(A.test, (r) => r.marketProb);
    const sMod = pickStats(A.test, (r) => r.modelProb);
    const sCombo = { win: 0, show: 0, n: 0 };
    for (let i = 0; i < A.test.length; i++) {
      const p = A.combo[i]!;
      let best = 0;
      for (let k = 1; k < p.length; k++) if (p[k]! > p[best]!) best = k;
      const ord = A.test[i]!.ords[best]!;
      sCombo.n++;
      if (ord === 1) sCombo.win++;
      if (ord <= 3) sCombo.show++;
    }

    const lastFit = A.bTrend.at(-1);
    const bStr = A.bTrend.map((t) => t.b.toFixed(2)).join(' ');
    const diff = nllCombo - nllMkt;
    const verdict = (A.bTrend.length > 0 && A.bTrend.every((t) => t.b > 0) && diff < 0)
      ? '정보 기여 O'
      : '정보 기여 X';
    console.log(`\n[${m}]  최종 a=${(lastFit?.a ?? 1).toFixed(2)} b=${(lastFit?.b ?? 0).toFixed(2)}  (분기별 b: ${bStr})`);
    console.log(`  NLL    합성 ${nllCombo.toFixed(4)} / 시장 ${nllMkt.toFixed(4)} / 모델 ${nllMod.toFixed(4)}   (합성-시장 ${diff >= 0 ? '+' : ''}${diff.toFixed(4)})`);
    console.log(`  단승   합성 ${pct(sCombo.win, sCombo.n)} / 시장 ${pct(sMkt.win, sMkt.n)} / 모델 ${pct(sMod.win, sMod.n)}  (n=${sCombo.n})`);
    console.log(`  연승   합성 ${pct(sCombo.show, sCombo.n)} / 시장 ${pct(sMkt.show, sMkt.n)} / 모델 ${pct(sMod.show, sMod.n)}`);
    console.log(`  -> 판정: ${verdict}  (조건: 모든 분기 b>0 그리고 합성 NLL<시장 NLL)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('오류:', e); process.exit(1); });
}
