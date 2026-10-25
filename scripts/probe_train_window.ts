/**
 * W-003 학습 기간 곡선 — 같은 시험 분기를, 직전 1·2·3·4년만 배운 Logistic(t3)로 채점.
 * 피처는 라이브 챔피언 artifact.features 그대로(게이트 선택 없음) → "학습 기간"만 바뀐다.
 * 로컬 DuckDB 미러만 사용 (KRA·Supabase 호출 0).
 *
 * 실행: npm run probe:train-window [-- --first-test 2025Q1 --to 20260630 --years 1,2,3,4]
 */
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import { rollingBlocks, quarterStart, parseYearQuarter } from '../src/engine/eval/rolling.js';
import { windowTrain, windowCovered, windowStart } from '../src/engine/eval/trainWindow.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import { rankHorses } from '../src/engine/eval/score.js';
import { emptyTally, addTally, type Tally } from '../src/engine/eval/market.js';
import { printRollingTable, type RollingRow } from '../src/engine/eval/report.js';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const firstTest = parseYearQuarter(arg('--first-test') ?? '2025Q1');
const dataTo = Number(arg('--to') ?? 20260630);
const years = (arg('--years') ?? '1,2,3,4').split(',').map(Number);

async function main(): Promise<void> {
  const db = await getLocalDb();
  const champ = await loadVersion(db);
  if (!champ || champ.model.kind !== 'logistic') throw new Error('활성 logistic 챔피언 없음');
  const schema = champ.model.model.features;
  console.log(`피처: 챔피언 ${champ.row.label} artifact.features ${schema.length}개 고정`);

  const firstStart = quarterStart(firstTest.year, firstTest.q);
  const dataFrom = windowStart(firstStart, Math.max(...years));
  console.log(`수집 ${dataFrom}~${dataTo} (par cutoff ${firstStart})...`);
  const races = await collectRaces(db, dataFrom, dataTo, { shapeParCutoff: firstStart });
  const actualFrom = Math.min(...races.map((r) => r.raceDate));
  console.log(`  ${races.length}경주 · 실제 최초 경주일 ${actualFrom}`);

  const seen = new Set(races.flatMap((r) => r.horses.flatMap((h) => h.features.map((f) => f.name))));
  const missing = schema.filter((f) => !seen.has(f));
  if (missing.length) console.log(`  ⚠️ 데이터에 없는 피처 ${missing.length}개(0으로 채움): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);

  const blocks = rollingBlocks(races, firstTest);
  const quarters = blocks.map((b) => b.key);
  const rows = new Map<string, RollingRow>();
  const label = (y: number) => `학습 ${y}년`;
  for (const y of years) rows.set(label(y), { method: label(y), byQuarter: new Map(), overall: emptyTally() });
  const market: RollingRow = { method: '시장', byQuarter: new Map(), overall: emptyTally() };

  for (const block of blocks) {
    const mt = emptyTally();
    for (const race of block.test) {
      const fav = [...race.horses].filter((h) => h.winOdds != null && h.winOdds > 0)
        .sort((a, b) => (a.winOdds as number) - (b.winOdds as number))[0] ?? null;
      addTally(mt, fav?.ord ?? null); addTally(market.overall, fav?.ord ?? null);
    }
    market.byQuarter.set(block.key, mt);

    for (const y of years) {
      const row = rows.get(label(y))!;
      if (!windowCovered(actualFrom, block.blockStart, y)) {
        console.log(`  ⚠️ [${block.key}] ${label(y)}: 창 시작 ${windowStart(block.blockStart, y)} < 첫 경주 ${actualFrom} — 휴장 며칠이면 무해, 수개월이면 창 불완전`);
      }
      const train = windowTrain(block.train, block.blockStart, y);
      const X = train.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
      const yTop3 = train.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
      const t0 = Date.now();
      const model = fitLogistic(X, yTop3, schema, { l2: 0.02, iters: 800, lr: 0.2 });
      const t: Tally = emptyTally();
      for (const race of block.test) {
        const ord = rankHorses({ kind: 'logistic', model }, race.horses)[0]?.ord ?? null;
        addTally(t, ord); addTally(row.overall, ord);
      }
      row.byQuarter.set(block.key, t);
      console.log(`  [${block.key}] ${label(y)}: 학습 ${train.length}경주 → 연승 ${(t.show / t.n * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
    }
  }

  const all = [market, ...rows.values()];
  printRollingTable(all, quarters);
  printRollingTable(all, quarters, 'win');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
