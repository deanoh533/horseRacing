/**
 * Backfill Predictions
 *
 * 기존에 동기화된 모든 경주에 대해 Score Engine 결과를 predictions 테이블에 저장
 *
 * 사용:
 *   npm run backfill              # 전체 race 재계산
 *   npm run backfill -- --date 20260523   # 특정 날짜만
 *
 * Idempotent: 같은 (race_date, meet, rc_no, hr_name)는 upsert.
 *   predictions 테이블에 UNIQUE 제약이 없으므로, 기존 row 삭제 후 insert.
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { predictRace } from '../src/engine/scorePredictor.js';
import pLimit from 'p-limit';

const CONCURRENCY = 3; // 너무 많이 동시 처리하면 Supabase rate-limit

async function main() {
  const args = process.argv.slice(2);
  let targetDate: number | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) targetDate = Number(args[i + 1]);
  }

  const sb = getSupabaseAdmin();

  // 1. 대상 race 목록
  let query = sb.from('races').select('race_date, meet, rc_no').order('race_date');
  if (targetDate) query = query.eq('race_date', targetDate);
  const { data: races, error } = await query;
  if (error) throw error;
  if (!races || races.length === 0) {
    console.log('대상 경주 없음');
    return;
  }

  console.log(`\n🏁 Backfill 시작: ${races.length}경주\n`);

  // 2. 병렬 처리
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let totalInserted = 0;
  let errors = 0;
  const startedAt = Date.now();

  await Promise.all(
    races.map((r) =>
      limit(async () => {
        try {
          const rows = await predictRace(sb, r.race_date, r.meet, r.rc_no);
          if (rows.length === 0) return;

          // 기존 행 삭제 (race+meet+rc_no 기준) 후 새로 insert
          await sb
            .from('predictions')
            .delete()
            .eq('race_date', r.race_date)
            .eq('meet', r.meet)
            .eq('rc_no', r.rc_no);

          const { error: insErr } = await sb.from('predictions').insert(rows);
          if (insErr) throw insErr;
          totalInserted += rows.length;
        } catch (e) {
          errors++;
          console.error(`❌ ${r.race_date} meet=${r.meet} rc=${r.rc_no}:`, (e as Error).message);
        } finally {
          done++;
          if (done % 20 === 0 || done === races.length) {
            const pct = ((done / races.length) * 100).toFixed(0);
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
            console.log(`  진행 ${done}/${races.length} (${pct}%, ${elapsed}s 경과)`);
          }
        }
      })
    )
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ 완료: ${races.length}경주 / ${totalInserted}행 저장 / 에러 ${errors} / ${elapsed}s`);
}

main().catch((err) => {
  console.error('💥 backfill 실패:', err);
  process.exit(1);
});
