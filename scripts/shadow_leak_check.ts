/**
 * 누수 점검 — 활성 모델의 보존된 수요일 사전 예측(predictions, L-001 이후)을
 * 과거 채우기 경로(미러 + forcePrecompetition)로 재계산해 일치 여부 판정.
 * ⚠️ 선행: npm run db:pull (미러 최신화). 읽기 전용, DB 쓰기 없음.
 * 사용: npm run shadow:leak-check -- [--from 20260711] [--to 20260917] [--sample 60]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { getActiveModelVersion } from '../src/engine/modelVersion.js';
import { gatherRaceInputs, scoreRaceRows } from '../src/engine/scorePredictor.js';
import { compareRace, summarize, type ScoreRow } from '../src/engine/shadow/leakCheck.js';

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20260711'));
  const to = Number(arg('--to', '20991231'));
  const sample = Number(arg('--sample', '60'));

  const db = await getReadClient();
  const active = await getActiveModelVersion(db);
  console.log(`🔎 누수 점검 — 활성 ${active.label}(id=${active.id}), ${from}~${to}, 표본 최대 ${sample}경주`);

  const { data, error } = await db.from('predictions')
    .select('race_date, meet, rc_no, hr_name, total_score, predicted_rank, model_version')
    .eq('model_version', active.id).gte('race_date', from).lte('race_date', to);
  if (error) throw error;
  const byRace = new Map<string, ScoreRow[]>();
  for (const p of (data ?? []) as (ScoreRow & { race_date: number; meet: number; rc_no: number })[]) {
    const k = `${p.race_date}-${p.meet}-${p.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(p);
  }
  // 균등 간격 표본 (재현 가능)
  const keys = [...byRace.keys()].sort();
  const step = Math.max(1, Math.floor(keys.length / sample));
  const picked = keys.filter((_, i) => i % step === 0).slice(0, sample);

  const results: { key: string; status: 'match' | 'field-changed' | 'mismatch'; maxAbsDiff: number }[] = [];
  for (const k of picked) {
    const [d, m, n] = k.split('-').map(Number) as [number, number, number];
    const rows = await gatherRaceInputs(db, d, m, n, { forcePrecompetition: true });
    const re = scoreRaceRows(rows, active, d, m, n);
    results.push({ key: k, ...compareRace(byRace.get(k)!, re) });
  }
  const s = summarize(results);
  for (const r of results.filter((x) => x.status === 'mismatch')) console.log(`  ❌ ${r.key} 최대 점수차 ${r.maxAbsDiff.toExponential(2)}`);
  console.log(`\n일치 ${s.match} · 출전마 변동(제외) ${s.fieldChanged} · 불일치 ${s.mismatch} → ${s.pass ? '✅ 합격' : '❌ 불합격'}`);
  writeFileSync('data/shadow_leak_check.json', JSON.stringify({ checkedAt: new Date().toISOString(), activeVersion: active.id, from, to, ...s }, null, 2));
  if (!s.pass) process.exit(1);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
