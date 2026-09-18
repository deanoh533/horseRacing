/**
 * 섀도 버전 과거 채우기 (spec 2026-09-18 §4.4).
 * 읽기 = 로컬 미러(DuckDB), 쓰기 = Supabase. 누수 점검 합격 기록이 없으면 거부.
 * 사용: npm run shadow:backfill -- --version 9 [--from 20260701] [--to 20260917] [--dry-run] [--force-unverified]
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { getShadowModelVersions } from '../src/engine/modelVersion.js';
import { predictShadows } from '../src/engine/shadowPredictor.js';
import { writeShadowPredictions } from '../src/sync/shadowWriter.js';
import { resolveBackfillRange } from '../src/engine/shadow/backfillRange.js';

function todayKst(): number {
  const s = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
  return Number(s);
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const versionId = Number(arg('--version'));
  const dryRun = args.includes('--dry-run');
  if (!versionId) throw new Error('--version <id> 필수');

  if (!args.includes('--force-unverified')) {
    const f = 'data/shadow_leak_check.json';
    const ok = existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).pass === true;
    if (!ok) throw new Error('누수 점검 합격 기록 없음 — 먼저 npm run shadow:leak-check (spec §5)');
  }

  const sbw = getSupabaseAdmin();
  // 버전 정보는 Supabase에서 (미러엔 is_shadow/train_until 컬럼이 아직 없을 수 있음)
  const version = (await getShadowModelVersions(sbw as never)).find((v) => v.id === versionId);
  if (!version) throw new Error(`id=${versionId}는 섀도 버전이 아님 (is_shadow=false 또는 없음)`);
  const fromArg = arg('--from'), toArg = arg('--to');
  const range = resolveBackfillRange(version.train_until, fromArg ? Number(fromArg) : undefined, toArg ? Number(toArg) : undefined, todayKst());
  console.log(`🧪 과거 채우기 ${version.label}(id=${versionId}) ${range.from}~${range.to}${dryRun ? ' [dry-run]' : ''}`);

  // 이미 사전 저장본(live)이 있는 경주는 건너뜀
  const { data: liveRows, error: liveErr } = await sbw.from('shadow_predictions')
    .select('race_date, meet, rc_no').eq('model_version', versionId).eq('source', 'live')
    .gte('race_date', range.from).lte('race_date', range.to);
  if (liveErr) throw liveErr;
  const liveKeys = new Set(((liveRows ?? []) as { race_date: number; meet: number; rc_no: number }[]).map((r) => `${r.race_date}-${r.meet}-${r.rc_no}`));

  const db = await getReadClient();
  const { data: races, error } = await db.from('races').select('race_date, meet, rc_no')
    .gte('race_date', range.from).lte('race_date', range.to).order('race_date').order('meet').order('rc_no');
  if (error) throw error;

  let written = 0, skipped = 0, noResult = 0;
  for (const r of (races ?? []) as { race_date: number; meet: number; rc_no: number }[]) {
    const key = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (liveKeys.has(key)) { skipped++; continue; }
    const { data: ords } = await db.from('race_entries').select('hr_name, ord')
      .eq('race_date', r.race_date).eq('meet', r.meet).eq('rc_no', r.rc_no);
    const ordMap = new Map(((ords ?? []) as { hr_name: string; ord: number | null }[]).map((o) => [o.hr_name, o.ord]));
    if (![...ordMap.values()].some((o) => o != null)) { noResult++; continue; }
    const rows = (await predictShadows(db, r.race_date, r.meet, r.rc_no, { forcePrecompetition: true, versionIds: [versionId], versions: [version] }))
      .map((p) => ({ ...p, actual_ord: ordMap.get(p.hr_name) ?? null }));
    if (!dryRun) await writeShadowPredictions(sbw, rows, 'backfill');
    written++;
    if (written % 50 === 0) console.log(`  ${written}경주…`);
  }
  console.log(`✅ 채움 ${written}경주 · 사전저장본 있어 건너뜀 ${skipped} · 결과 없음 ${noResult}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
