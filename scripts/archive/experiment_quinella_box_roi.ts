/**
 * 실험: 복승 박스 ROI — top-K 픽 안 모든 쌍에 1000원씩, 롤링.
 * K=2(단일쌍)·3·4 박스. 1·2착이 둘 다 top-K 안이면 우승쌍 1개가 1000×배당 회수.
 * 투자 = C(K,2)×1000/경주. 배당: data/quinella_dividends.jsonl.
 * 사용: npx tsx scripts/experiment_quinella_box_roi.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { runGateB } from '../src/engine/eval/gates.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { rankHorses, type ScorableModel } from '../src/engine/eval/score.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import type { HorseRecord } from '../src/engine/eval/types.js';

const FIRST_TEST = { year: 2025, q: 1 };
const STAKE = 1000;
const KS = [2, 3, 4];
const nPairs = (k: number) => (k * (k - 1)) / 2;
const METHODS = [
  '시장', '챔피언', 'Spearman',
  'Logistic(t1)', 'Logistic(t2)', 'Logistic(t3)',
  'GBDT(t1)', 'GBDT(t2)', 'GBDT(t3)', 'PL',
] as const;
type Method = typeof METHODS[number];

interface Acc { hit: number; n: number; stake: number; ret: number; }
const empty = (): Acc => ({ hit: 0, n: 0, stake: 0, ret: 0 });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const roiOf = (a: Acc) => (a.stake ? (a.ret - a.stake) / a.stake : 0);

function byOdds(horses: HorseRecord[]): HorseRecord[] {
  return horses.filter((h) => h.winOdds != null && h.winOdds > 0)
    .sort((a, b) => (a.winOdds as number) - (b.winOdds as number));
}
const pairKey = (d: number, m: number, r: number, x: number, y: number) =>
  `${d}-${m}-${r}-${Math.min(x, y)}-${Math.max(x, y)}`;

function loadDividends(): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of readFileSync('data/quinella_dividends.jsonl', 'utf8').split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line) as { race_date: number; meet: number; rc_no: number; a: number; b: number; odds: number };
    map.set(pairKey(o.race_date, o.meet, o.rc_no, o.a, o.b), o.odds);
  }
  return map;
}

async function main(): Promise<void> {
  const div = loadDividends();
  console.log(`복승 배당 ${div.size}조합 로드`);
  const db = await getLocalDb();
  console.log('데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const champ = await loadVersion(db);
  if (!champ) throw new Error('챔피언 없음');
  console.log(`챔피언: ${champ.row.label} (id=${champ.row.id}, kind=${champ.model.kind})`);
  console.log('Gate B 선별 중...');
  const approved = new Set(runGateB(races).filter((g) => g.include).map((g) => g.itemId));

  const blocks = rollingBlocks(races, FIRST_TEST);
  // method → K → Acc
  const acc = new Map<Method, Map<number, Acc>>(METHODS.map((m) => [m, new Map(KS.map((k) => [k, empty()]))]));
  let settled = 0, skipped = 0;

  for (const block of blocks) {
    console.log(`  [${block.key}] train=${block.train.length} test=${block.test.length} 학습중...`);
    const tm = trainAllModels(block.train, approved);
    const scorers: Map<Method, ScorableModel> = new Map([
      ['챔피언', champ.model],
      ['Spearman', { kind: 'weights', weights: tm.spearmanWeights } as ScorableModel],
      ['Logistic(t1)', { kind: 'logistic', model: tm.logisticTop1 } as ScorableModel],
      ['Logistic(t2)', { kind: 'logistic', model: tm.logisticTop2 } as ScorableModel],
      ['Logistic(t3)', { kind: 'logistic', model: tm.logisticTop3 } as ScorableModel],
      ['GBDT(t1)', { kind: 'gbdt', model: tm.gbdtTop1, schema: tm.featureSchema } as ScorableModel],
      ['GBDT(t2)', { kind: 'gbdt', model: tm.gbdtTop2, schema: tm.featureSchema } as ScorableModel],
      ['GBDT(t3)', { kind: 'gbdt', model: tm.gbdtTop3, schema: tm.featureSchema } as ScorableModel],
      ['PL', { kind: 'pl', model: tm.pl, schema: tm.featureSchema } as ScorableModel],
    ]);

    for (const race of block.test) {
      const a1 = race.horses.find((h) => h.ord === 1);
      const a2 = race.horses.find((h) => h.ord === 2);
      if (!a1 || !a2) continue;
      const winOdds = div.get(pairKey(race.raceDate, race.meet, race.rcNo, a1.pthrNo, a2.pthrNo));
      if (winOdds === undefined) { skipped++; continue; }
      settled++;

      for (const m of METHODS) {
        const order = m === '시장' ? byOdds(race.horses) : rankHorses(scorers.get(m)!, race.horses);
        for (const K of KS) {
          const topK = order.slice(0, K).map((h) => h.pthrNo);
          const a = acc.get(m)!.get(K)!;
          a.n++; a.stake += nPairs(K) * STAKE;
          if (topK.includes(a1.pthrNo) && topK.includes(a2.pthrNo)) {
            a.hit++; a.ret += STAKE * winOdds; // 박스 안 우승쌍 1개만 적중
          }
        }
      }
    }
  }

  console.log(`\n정산 경주 ${settled}건 / 배당결손 제외 ${skipped}건`);
  console.log('\n=== 복승 박스 ROI (top-K 박스, 쌍당 1000원, 롤링) ===\n');
  console.log('방법'.padEnd(15) + '│  top2 (단일쌍)  │  top3 박스      │  top4 박스');
  console.log('               │ 적중률  ROI     │ 적중률  ROI     │ 적중률  ROI');
  console.log('─'.repeat(72));
  for (const m of METHODS) {
    const cell = (K: number) => {
      const a = acc.get(m)!.get(K)!;
      const roi = roiOf(a);
      return `${pct(a.hit / a.n).padStart(6)} ${(roi >= 0 ? '+' : '') + pct(roi)}`.padEnd(15);
    };
    console.log(m.padEnd(15) + '│ ' + cell(2) + ' │ ' + cell(3) + ' │ ' + cell(4));
  }
  console.log('\n※ top-K 박스 적중률 = 실제 1·2착이 둘 다 top-K 안에 든 비율. 투자=C(K,2)×1000/경주.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
