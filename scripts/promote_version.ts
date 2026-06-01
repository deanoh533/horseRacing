/**
 * 모델 버전 승격 (Stage B) — 로컬 실행
 *
 * 지정한 버전을 활성으로 전환하고, **미확정(ord NULL) 예측만 재생성**한다.
 * 결과 확정된 과거 예측은 동결(라이브 기록 보존) — 덮어쓰지 않는다.
 *
 * 사용: npm run promote -- --version <id>
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { predictRace } from '../src/engine/scorePredictor.js';

async function main() {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf('--version');
  const versionId = vIdx >= 0 ? Number(args[vIdx + 1]) : NaN;
  if (!Number.isFinite(versionId)) throw new Error('사용법: npm run promote -- --version <id>');

  const sb = getSupabaseAdmin();
  const { data: target, error: e0 } = await sb
    .from('model_versions')
    .select('id, label, is_active')
    .eq('id', versionId)
    .maybeSingle();
  if (e0) throw e0;
  if (!target) throw new Error(`model_versions id=${versionId} 없음`);
  if (target.is_active) {
    console.log(`이미 활성 버전입니다: ${target.label} (id=${versionId}) — 변경 없음`);
    return;
  }

  // 1. 활성 포인터 전환 (partial unique index: 기존 false 먼저 → 대상 true)
  console.log(`[1/2] 활성 버전 전환 → ${target.label} (id=${versionId})`);
  await sb.from('model_versions').update({ is_active: false }).eq('is_active', true);
  const { error: e1 } = await sb.from('model_versions').update({ is_active: true }).eq('id', versionId);
  if (e1) throw e1;

  // 2. 미확정(ord NULL) 예측만 재생성 — 확정 과거는 동결
  console.log('[2/2] 미확정(결과 없음) 예측 재생성 (확정 과거는 동결)...');
  const pendRaces: { race_date: number; meet: number; rc_no: number }[] = [];
  const seen = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no')
      .is('actual_ord', null)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number }[]) {
      const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
      if (!seen.has(k)) {
        seen.add(k);
        pendRaces.push(r);
      }
    }
    if (data.length < PAGE) break;
  }

  let regen = 0;
  for (const r of pendRaces) {
    const rows = await predictRace(sb, r.race_date, r.meet, r.rc_no);
    if (rows.length === 0) continue;
    await sb
      .from('predictions')
      .delete()
      .eq('race_date', r.race_date)
      .eq('meet', r.meet)
      .eq('rc_no', r.rc_no);
    const { error } = await sb.from('predictions').insert(rows);
    if (error) throw error;
    regen += rows.length;
  }

  console.log(`\n✅ 승격 완료: ${target.label} 활성.`);
  console.log(`   미확정 ${pendRaces.length}경주 / ${regen}행을 새 버전으로 재생성.`);
  console.log('   확정된 과거 예측은 동결 유지 (정직한 라이브 기록 보존).');
  console.log('   롤백하려면: npm run promote -- --version <이전 id>');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
