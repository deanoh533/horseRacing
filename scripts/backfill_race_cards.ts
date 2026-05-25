/**
 * 과거 race_cards 백필
 *  - races 테이블의 unique race_date 가져와서
 *  - 각 날짜에 대해 raceCardSync.syncRaceCards 호출
 *  - 이미 race_cards에 있는 날짜는 skip (idempotent re-run)
 *  - KRA rate limit 도달 시 중단 + 진행 보고
 *
 *  사용: npm run sync:cards:bulk
 *        npm run sync:cards:bulk -- --from 20240524 --to 20241231
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { syncRaceCards } from '../src/sync/raceCardSync.js';

async function main() {
  const args = process.argv.slice(2);
  let fromDate = 0;
  let toDate = 99991231;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) fromDate = Number(args[i + 1]);
    if (args[i] === '--to' && args[i + 1]) toDate = Number(args[i + 1]);
  }

  const sb = getSupabaseAdmin();

  console.log('[1/3] races의 unique race_date 수집...');
  const allDates = new Set<number>();
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('races')
      .select('race_date')
      .gte('race_date', fromDate)
      .lte('race_date', toDate)
      .order('race_date')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    data.forEach((r) => allDates.add(r.race_date));
    if (data.length < 1000) break;
  }
  const dates = [...allDates].sort((a, b) => a - b);
  console.log(`  unique 날짜: ${dates.length}`);

  console.log('[2/3] race_cards에 이미 있는 날짜 제외...');
  const existing = new Set<number>();
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('race_cards')
      .select('race_date')
      .order('race_date')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    data.forEach((r) => existing.add(r.race_date));
    if (data.length < 1000) break;
  }
  console.log(`  기존 날짜: ${existing.size}`);

  const todo = dates.filter((d) => !existing.has(d));
  console.log(`  fetch 대상: ${todo.length} 날짜`);
  if (todo.length === 0) {
    console.log('✅ 모두 완료');
    return;
  }

  console.log('\n[3/3] 날짜별 sync...');
  const startedAt = Date.now();
  let totalRaces = 0;
  let totalHorses = 0;
  let rateLimited = false;

  for (const [i, date] of todo.entries()) {
    try {
      const results = await syncRaceCards({ rcDate: date });
      const races = results.reduce((s, r) => s + r.racesSynced, 0);
      const horses = results.reduce((s, r) => s + r.horsesSynced, 0);
      const errors = results.flatMap((r) => r.errors);
      totalRaces += races;
      totalHorses += horses;

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`  [${i + 1}/${todo.length}] ${date}: ${races} races / ${horses} horses (${elapsed}s)`);

      if (errors.some((e) => e.includes('rate limit'))) {
        rateLimited = true;
        console.error('\n❌ KRA rate limit — 중단');
        break;
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('429') || msg.includes('LIMITED_NUMBER')) {
        rateLimited = true;
        console.error('\n❌ KRA rate limit (전체 throw) — 중단');
        break;
      }
      console.error(`  ${date}: ERR ${msg.slice(0, 80)}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n✅ 종료: ${totalRaces} races / ${totalHorses} horses / ${elapsed}s`);
  if (rateLimited) {
    console.log('⚠️ Rate limit으로 중단. 내일 재실행 (이미 처리된 날짜는 skip).');
  }
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
