/**
 * 실험: GBDT 학습 라벨 폭(top1..top8) 스윕 — 롤링 연승율(1순위 픽 3착내) 곡선.
 * production benchmark는 안 건드리고 GBDT만 별도로 본다.
 * 사용: npx tsx scripts/experiment_gbdt_labels.ts
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { runGateB } from '../src/engine/eval/gates.js';
import { rollingBlocks, quarterKey } from '../src/engine/eval/rolling.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { featureToItem } from '../src/engine/features/featureItemMap.js';
import { fitGBDT, predictGBDT } from '../src/engine/models/gbdt.js';

const FIRST_TEST = { year: 2025, q: 1 };
const KS = [1, 2, 3, 4, 5, 6, 7, 8];

interface Tally { show: number; n: number; }
const empty = (): Tally => ({ show: 0, n: 0 });
const add = (t: Tally, ord: number | null) => { if (ord != null && ord <= 50) { t.n++; if (ord <= 3) t.show++; } };
const pct = (t: Tally) => (t.n ? `${(t.show / t.n * 100).toFixed(1)}%` : '-');

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('📊 GBDT 라벨 폭 스윕 (top1..top8)\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  // 출전마 수 분포 (top-k 라벨의 유효성 판단용)
  const sizes = races.map((r) => r.horses.length).sort((a, b) => a - b);
  const avg = sizes.reduce((s, v) => s + v, 0) / sizes.length;
  const median = sizes[Math.floor(sizes.length / 2)]!;
  console.log(`\n출전마 수: 평균 ${avg.toFixed(1)} / 중앙값 ${median} / 최소 ${sizes[0]} / 최대 ${sizes[sizes.length - 1]}`);
  console.log('top-k가 "전원"이 되는(=라벨 변별력 0) 경주 비율:');
  for (const k of KS) {
    const deg = races.filter((r) => r.horses.length <= k).length;
    console.log(`  top${k}: ${(deg / races.length * 100).toFixed(1)}% (출전마 ≤ ${k})`);
  }

  // Gate B 승인 항목 (benchmark와 동일 조건)
  console.log('\nGate B 항목 선별 중...');
  const approved = new Set(runGateB(races).filter((g) => g.include).map((g) => g.itemId));

  const blocks = rollingBlocks(races, FIRST_TEST);
  const quarters = blocks.map((b) => b.key);
  // k → quarter → tally,  k → overall
  const byK = new Map<number, Map<string, Tally>>(KS.map((k) => [k, new Map()]));
  const overall = new Map<number, Tally>(KS.map((k) => [k, empty()]));

  for (const block of blocks) {
    console.log(`  [${block.key}] train=${block.train.length} test=${block.test.length} GBDT×${KS.length} 학습중...`);
    const schema = buildSchema(block.train.flatMap((r) => r.horses.map((h) => h.features)))
      .filter((name) => approved.has(featureToItem(name)) && !name.endsWith('__missing'));
    const X = block.train.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));

    for (const k of KS) {
      const y = block.train.flatMap((r) => r.horses.map((h) => (h.ord <= k ? 1 : 0)));
      const model = fitGBDT(X, y, schema);
      const qt = empty();
      for (const race of block.test) {
        const top = [...race.horses]
          .map((h) => ({ h, s: predictGBDT(model, toVector(h.features, schema)) }))
          .sort((a, b) => b.s - a.s)[0];
        add(qt, top?.h.ord ?? null);
        add(overall.get(k)!, top?.h.ord ?? null);
      }
      byK.get(k)!.set(block.key, qt);
    }
  }

  console.log('\n=== GBDT 라벨 폭별 롤링 연승율 (1순위 픽 3착내) ===\n');
  const header = '라벨    │' + quarters.map((q) => ` ${q} `).join('│') + '│ 전체';
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const k of KS) {
    const cells = quarters.map((q) => ` ${pct(byK.get(k)!.get(q) ?? empty()).padStart(6)} `).join('│');
    console.log(`top${k}    │`.padStart(9) + cells + '│ ' + pct(overall.get(k)!));
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
