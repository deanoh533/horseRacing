/**
 * 실험: 쌍승(Exacta, 1·2착 순서 정확) 적중률 — 전 방법 롤링 비교.
 * 평가 지표만 바꾼다: "1·2순위 픽이 실제 1·2착과 순서까지 일치".
 * 복승(Quinella, 순서 무관)도 참고로 함께 출력.
 * 사용: npx tsx scripts/experiment_exacta.ts
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { runGateB } from '../src/engine/eval/gates.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { rankHorses, type ScorableModel } from '../src/engine/eval/score.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import type { HorseRecord, RaceRecord } from '../src/engine/eval/types.js';

const FIRST_TEST = { year: 2025, q: 1 };
const METHODS = [
  '시장', '챔피언', 'Spearman',
  'Logistic(t1)', 'Logistic(t2)', 'Logistic(t3)',
  'GBDT(t1)', 'GBDT(t2)', 'GBDT(t3)', 'PL',
] as const;
type Method = typeof METHODS[number];

interface Tally { exacta: number; quinella: number; n: number; }
const empty = (): Tally => ({ exacta: 0, quinella: 0, n: 0 });
const pct = (a: number, n: number) => (n ? `${(a / n * 100).toFixed(1)}%` : '-');

/** win_odds 오름차순(인기순) 정렬, 유효 배당만 */
function byOdds(horses: HorseRecord[]): HorseRecord[] {
  return horses.filter((h) => h.winOdds != null && h.winOdds > 0)
    .sort((a, b) => (a.winOdds as number) - (b.winOdds as number));
}

/** 한 경주에서 1·2순위 픽으로 쌍승/복승 적중 누적 */
function tallyRace(t: Tally, order: HorseRecord[], race: RaceRecord): void {
  const a1 = race.horses.find((h) => h.ord === 1);
  const a2 = race.horses.find((h) => h.ord === 2);
  if (!a1 || !a2) return; // 1·2착 확정 안 된 경주 제외
  const p1 = order[0], p2 = order[1];
  if (!p1 || !p2) return;
  t.n++;
  if (p1.pthrNo === a1.pthrNo && p2.pthrNo === a2.pthrNo) t.exacta++;       // 순서까지
  const pickSet = new Set([p1.pthrNo, p2.pthrNo]);
  if (pickSet.has(a1.pthrNo) && pickSet.has(a2.pthrNo)) t.quinella++;       // 순서 무관
}

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('📊 쌍승(Exacta) 적중률 — 전 방법 롤링\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const champ = await loadVersion(db);
  if (!champ) throw new Error('챔피언 없음');
  console.log(`챔피언: ${champ.row.label} (id=${champ.row.id}, kind=${champ.model.kind})`);

  console.log('Gate B 선별 중...');
  const approved = new Set(runGateB(races).filter((g) => g.include).map((g) => g.itemId));

  const blocks = rollingBlocks(races, FIRST_TEST);
  const overall = new Map<Method, Tally>(METHODS.map((m) => [m, empty()]));

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
      for (const m of METHODS) {
        const order = m === '시장' ? byOdds(race.horses) : rankHorses(scorers.get(m)!, race.horses);
        tallyRace(overall.get(m)!, order, race);
      }
    }
  }

  console.log('\n=== 쌍승(순서 정확) / 복승(순서 무관) 적중률 — 전체 롤링 ===\n');
  console.log('방법'.padEnd(16) + '│ 쌍승   │ 복승   │ n');
  console.log('─'.repeat(44));
  for (const m of METHODS) {
    const t = overall.get(m)!;
    console.log(m.padEnd(16) + `│ ${pct(t.exacta, t.n).padStart(6)} │ ${pct(t.quinella, t.n).padStart(6)} │ ${t.n}`);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
