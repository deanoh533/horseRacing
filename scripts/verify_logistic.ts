/**
 * 로지스틱 라이브 전환 전 검증 (읽기전용).
 *  - 파리티: 오프라인(행렬→predictLogit) vs 라이브(gatherRaceInputs→scoreLogistic) 총점/순위 일치.
 *  - 섐도우: 라이브 로지스틱 순위 top3 적중률.
 * 사용: npm run verify:logistic -- --matrix data/training_matrix.jsonl --split 20250101 --races 80
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { gatherRaceInputs } from '../src/engine/scorePredictor.js';
import { scoreLogistic } from '../src/engine/logisticScorer.js';
import { fitLogistic, predictLogit, type LogisticModel } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; top3: number; features: Feature[]; }

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));
  const maxRaces = Number(arg('--races', '80'));

  const all: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);
  const schema = buildSchema(train.map((r) => r.features));
  const model: LogisticModel = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });

  const byRace = new Map<string, Row[]>();
  for (const r of test) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; if (!byRace.has(k)) byRace.set(k, []); byRace.get(k)!.push(r); }
  const raceKeys = [...byRace.keys()].slice(0, maxRaces);

  const sb = await getReadClient();
  let parityRaces = 0, parityMismatch = 0;
  let liveHit = 0, total = 0;

  for (const rk of raceKeys) {
    const [d, m, n] = rk.split('-').map(Number);
    const offline = byRace.get(rk)!.map((r) => ({ hr: r.hr_name, s: predictLogit(model, toVector(r.features, schema)), ord: r.ord }));
    const inputs = await gatherRaceInputs(sb, d!, m!, n!);
    const live = inputs.map((row) => ({ hr: row.hr_name, s: scoreLogistic(model, row.input).total, ord: row.ord }));

    const liveByHr = new Map(live.map((x) => [x.hr, x.s]));
    let mism = false;
    for (const o of offline) {
      const lv = liveByHr.get(o.hr);
      if (lv == null || Math.abs(lv - o.s) > 1e-6) mism = true;
    }
    parityRaces++; if (mism) parityMismatch++;

    const sorted = [...live].filter((x) => x.ord != null).sort((a, b) => b.s - a.s);
    if (sorted.length) { total++; if ((sorted[0]!.ord as number) <= 3) liveHit++; }
  }

  console.log(`\n[파리티] 경주 ${parityRaces} 중 불일치 ${parityMismatch} → ${parityMismatch === 0 ? '✅ 라이브==오프라인' : '❌ 불일치(피처 재계산 버그 의심)'}`);
  console.log(`[섐도우] 라이브 로지스틱 연승(1픽 top3) 적중: ${total ? (liveHit / total * 100).toFixed(1) : 0}% (n=${total})`);
  console.log('판정(사람): 파리티 ✅ + 섐도우가 v1 수준(연승 ~57%+) 이상이면 promote 고려.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
