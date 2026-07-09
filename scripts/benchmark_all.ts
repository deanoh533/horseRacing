/**
 * Rolling Benchmark — 분기 확장윈도우로 9모델 + 챔피언 + 시장 진단.
 * 사용: npm run benchmark  [-- --gate-only | --no-gate | --champion <id>]
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { runGateA, printGateA, runGateB, printGateB } from '../src/engine/eval/gates.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { marketDiagnostics, printMarketDiag, emptyTally, addTally } from '../src/engine/eval/market.js';
import type { Tally } from '../src/engine/eval/market.js';
import { rankHorses, type ScorableModel } from '../src/engine/eval/score.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import { printRollingTable, type RollingRow } from '../src/engine/eval/report.js';

const FIRST_TEST = { year: 2025, q: 1 };

const METHODS = [
  '시장', '챔피언', 'Spearman',
  'Logistic(t1)', 'Logistic(t2)', 'Logistic(t3)',
  'GBDT(t1)', 'GBDT(t2)', 'GBDT(t3)',
  'PL',
] as const;
type Method = typeof METHODS[number];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const gateOnly = args.includes('--gate-only');
  const noGate = args.includes('--no-gate');
  const champIdx = args.indexOf('--champion');
  const championId = champIdx >= 0 ? Number(args[champIdx + 1]) : undefined;
  const inclIdx = args.indexOf('--include');
  const forceInclude = inclIdx >= 0 ? args[inclIdx + 1] : undefined;
  const exclIdx = args.indexOf('--exclude');
  const forceExclude = exclIdx >= 0 ? args[exclIdx + 1] : undefined;

  const db = await getLocalDb();
  console.log('📊 Rolling Benchmark 시작\n데이터 수집 중...');
  const SHAPE_PAR_CUTOFF = FIRST_TEST.year * 10000 + 101; // 2025Q1 → 20250101
  const races = await collectRaces(db, 20240101, 99991231, { shapeParCutoff: SHAPE_PAR_CUTOFF });
  console.log(`  ${races.length}경주`);

  let approved: Set<string>;
  if (noGate) {
    approved = new Set(races.flatMap((r) => r.horses.flatMap((h) => Object.keys(h.rawScores))));
  } else {
    console.log('\n[게이트 A]'); printGateA(runGateA(races));
    console.log('\n[게이트 B]');
    const gb = runGateB(races); printGateB(gb);
    approved = new Set(gb.filter((g) => g.include).map((g) => g.itemId));
  }
  if (forceInclude) { approved.add(forceInclude); console.log(`  ⚡ 강제 포함: ${forceInclude}`); }
  if (forceExclude) { approved.delete(forceExclude); console.log(`  ⚡ 강제 제외: ${forceExclude}`); }
  if (gateOnly) return;

  const champ = await loadVersion(db, championId !== undefined ? { id: championId } : {});
  if (!champ) throw new Error('챔피언 버전 없음');
  console.log(`\n챔피언: ${champ.row.label} (id=${champ.row.id}, kind=${champ.model.kind})`);

  const blocks = rollingBlocks(races, FIRST_TEST);
  const quarters = blocks.map((b) => b.key);

  const tallies = new Map<Method, Map<string, Tally>>(
    METHODS.map((m) => [m, new Map<string, Tally>()])
  );
  const overall = new Map<Method, Tally>(
    METHODS.map((m) => [m, emptyTally()])
  );
  const allTest = blocks.flatMap((b) => b.test);

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
      const favorite = [...race.horses]
        .filter((h) => h.winOdds != null && h.winOdds > 0)
        .sort((a, b) => (a.winOdds as number) - (b.winOdds as number))[0] ?? null;

      for (const m of METHODS) {
        const tmap = tallies.get(m)!;
        if (!tmap.has(block.key)) tmap.set(block.key, emptyTally());

        let pickOrd: number | null;
        if (m === '시장') {
          pickOrd = favorite?.ord ?? null;
        } else {
          const scorer = scorers.get(m)!;
          pickOrd = rankHorses(scorer, race.horses)[0]?.ord ?? null;
        }

        addTally(tmap.get(block.key)!, pickOrd);
        addTally(overall.get(m)!, pickOrd);
      }
    }
  }

  const rows: RollingRow[] = METHODS.map((m) => ({
    method: m,
    byQuarter: tallies.get(m)!,
    overall: overall.get(m)!,
  }));
  printRollingTable(rows, quarters);

  console.log('\n=== 시장 깊은 진단 (챔피언 vs 시장, 전체 test) ===');
  printMarketDiag(marketDiagnostics(allTest, champ.model));
}

// 직접 실행 시에만 main() 구동 (import 부작용 방지 — getLocalDb 중복 오픈 race 차단)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('💥', e); process.exit(1); });
}
