/**
 * 실험: 복승(Quinella) ROI — 각 방법의 1·2위 픽 조합에 1000원 베팅, 롤링.
 * 회수 = 우승조합(실제 1·2착) 적중 시 1000 × 복승배당(원금포함). 미적중 0.
 * 배당: data/quinella_dividends.jsonl (a<b=chulNo=pthr_no, odds=배당률).
 * 사용: npx tsx scripts/experiment_quinella_roi.ts
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
const METHODS = [
  '시장', '챔피언', 'Spearman',
  'Logistic(t1)', 'Logistic(t2)', 'Logistic(t3)',
  'GBDT(t1)', 'GBDT(t2)', 'GBDT(t3)', 'PL',
] as const;
type Method = typeof METHODS[number];

interface Acc { hit: number; n: number; stake: number; ret: number; divSum: number; }
const empty = (): Acc => ({ hit: 0, n: 0, stake: 0, ret: 0, divSum: 0 });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function byOdds(horses: HorseRecord[]): HorseRecord[] {
  return horses.filter((h) => h.winOdds != null && h.winOdds > 0)
    .sort((a, b) => (a.winOdds as number) - (b.winOdds as number));
}
const pairKey = (d: number, m: number, r: number, x: number, y: number) =>
  `${d}-${m}-${r}-${Math.min(x, y)}-${Math.max(x, y)}`;

function loadDividends(): Map<string, number> {
  const map = new Map<string, number>();
  const txt = readFileSync('data/quinella_dividends.jsonl', 'utf8');
  for (const line of txt.split('\n')) {
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
  const acc = new Map<Method, Acc>(METHODS.map((m) => [m, empty()]));
  let settled = 0, skippedNoDiv = 0;

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
      const winKey = pairKey(race.raceDate, race.meet, race.rcNo, a1.pthrNo, a2.pthrNo);
      const winOdds = div.get(winKey);
      if (winOdds === undefined) { skippedNoDiv++; continue; } // 배당 결손 경주 제외
      settled++;
      const winSet = new Set([a1.pthrNo, a2.pthrNo]);

      for (const m of METHODS) {
        const order = m === '시장' ? byOdds(race.horses) : rankHorses(scorers.get(m)!, race.horses);
        const p1 = order[0], p2 = order[1];
        const a = acc.get(m)!;
        if (!p1 || !p2) continue;
        a.n++; a.stake += STAKE;
        if (winSet.has(p1.pthrNo) && winSet.has(p2.pthrNo)) {
          a.hit++; a.ret += STAKE * winOdds; a.divSum += winOdds;
        }
      }
    }
  }

  console.log(`\n정산 경주 ${settled}건 / 배당결손 제외 ${skippedNoDiv}건`);
  console.log('\n=== 복승 ROI (1·2위 픽 조합에 1000원, 롤링) ===\n');
  console.log('방법'.padEnd(15) + '│ 적중률 │ 투자       │ 회수       │ ROI     │ 적중시 평균배당');
  console.log('─'.repeat(78));
  for (const m of METHODS) {
    const a = acc.get(m)!;
    const roi = a.stake ? (a.ret - a.stake) / a.stake : 0;
    const avgDiv = a.hit ? a.divSum / a.hit : 0;
    console.log(
      m.padEnd(15) + '│ ' +
      pct(a.hit / a.n).padStart(6) + ' │ ' +
      `${a.stake.toLocaleString()}원`.padStart(10) + ' │ ' +
      `${Math.round(a.ret).toLocaleString()}원`.padStart(10) + ' │ ' +
      `${roi >= 0 ? '+' : ''}${pct(roi)}`.padStart(7) + ' │ ' +
      `${avgDiv.toFixed(1)}배`
    );
  }
  console.log('\n※ 복승 공제율 보통 ~20-27% → 무작위·평균 베팅 ROI는 대략 -20~-27% 부근이 기준선.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
