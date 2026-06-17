import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';
import { makeLocalClient } from '../src/db/localDb.js';
import { gatherRaceInputs } from '../src/engine/scorePredictor.js';
import { scoreLogistic } from '../src/engine/logisticScorer.js';
import type { LogisticModel } from '../src/engine/models/logistic.js';

// DuckDB 직접 연결 (CAST AS JSON로 artifact 우회)
const inst = await DuckDBInstance.create('data/local.duckdb');
const conn = await inst.connect();
const db = makeLocalClient(conn);

// artifact를 JSON 문자열로 가져와서 파싱
const modelRes = await conn.runAndReadAll(
  "SELECT id, model_type, CAST(artifact AS JSON) as artifact_json FROM model_versions WHERE is_active = true LIMIT 1"
);
const modelRows = modelRes.getRowObjects();
if (modelRows.length === 0) throw new Error('활성 모델 없음');
const modelRow = modelRows[0] as any;
const model: LogisticModel = JSON.parse(modelRow.artifact_json);
console.log(`모델: id=${modelRow.id}, type=${modelRow.model_type}, features=${model.features.length}개`);

const TARGET_DATES = [20260606, 20260607, 20260613];

const { data: races } = await db.from('races')
  .select('race_date,meet,rc_no')
  .in('race_date', TARGET_DATES)
  .order('race_date').order('meet').order('rc_no');

if (!races || races.length === 0) { console.log('경주 없음'); process.exit(0); }

const lines: string[] = [];
const log = (s: string) => { lines.push(s); process.stdout.write(s + '\n'); };

let prevDate = 0;

for (const race of races) {
  const { race_date: rcDate, meet, rc_no: rcNo } = race as any;
  try {
    const rows = await gatherRaceInputs(db, rcDate, meet, rcNo);
    const withOrd = rows.filter(r => r.ord !== null && r.ord < 50);
    if (withOrd.length < 2) continue;

    // 로지스틱 모델로 점수 계산
    const scored = withOrd
      .map(r => ({ no: r.pthr_no, name: r.hr_name, score: scoreLogistic(model, r.input).total, ord: r.ord as number }))
      .sort((a, b) => b.score - a.score);

    const pred3 = scored.slice(0, 3).map(h => `${h.no}번`).join(', ');
    const actualSorted = [...withOrd].sort((a, b) => (a.ord as number) - (b.ord as number));
    const act3 = actualSorted.slice(0, 3).map(r => `${r.pthr_no}번`).join(', ');

    const top1ord = scored[0]!.ord;
    const mark = top1ord === 1 ? '🎯' : top1ord <= 3 ? '✅' : '❌';

    if (rcDate !== prevDate) {
      const d = String(rcDate);
      const meetName = meet === 1 ? '서울' : '부경';
      log(`\n── ${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} (${meetName}) ──`);
      prevDate = rcDate;
    }

    log(`  ${rcNo}R ${mark}  예측: ${pred3}  /  실제: ${act3}`);
  } catch(e: any) {
    log(`  ${rcDate} ${rcNo}R 에러: ${e.message}`);
  }
}

writeFileSync('docs/accuracy_check_20260606_13.txt', lines.join('\n'), 'utf8');
log('\n저장: docs/accuracy_check_20260606_13.txt');
