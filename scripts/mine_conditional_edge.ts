/**
 * 조건부 엣지 마이닝 — 모델top1 vs 인기top1 정면대결을 조건 구간별로.
 * 사용: npm run mine:edge [-- --champion <id> --min-n <N> --no-combos]
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import { recordEdges, aggregate, formatReport, sparkline } from '../src/engine/eval/edgeMining.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const champIdx = args.indexOf('--champion');
  const championId = champIdx >= 0 ? Number(args[champIdx + 1]) : undefined;
  const minNIdx = args.indexOf('--min-n');
  const minCellN = minNIdx >= 0 ? Number(args[minNIdx + 1]) : 20;
  const combos = !args.includes('--no-combos');

  const db = await getLocalDb();
  console.log('📊 조건부 엣지 마이닝\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const champ = await loadVersion(db, championId !== undefined ? { id: championId } : {});
  if (!champ) throw new Error('챔피언 버전 없음');
  console.log(`챔피언: ${champ.row.label} (id=${champ.row.id})`);

  const rows = recordEdges(races, champ.model);
  console.log(`불일치 경주(모델1순위≠인기1순위): ${rows.length}건  (minCellN=${minCellN}, combos=${combos})\n`);

  const stats = aggregate(rows, { minCellN, minQuarters: 6, positiveRatio: 0.6, combos });
  console.log(formatReport(stats, minCellN));

  const cands = stats.filter((s) => s.verdict === '채택후보');
  console.log(`\n채택후보 ${cands.length}건`);
  for (const s of cands) console.log(`  ${s.segment}\n    ${sparkline(s.quarters, minCellN)}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
