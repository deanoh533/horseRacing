/**
 * Statistics 페이지 hooks가 anon 키로 잘 동작하는지 검증
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

  console.log('=== weight_history (anon) ===');
  const { data: wh, count: whCount } = await sb
    .from('weight_history')
    .select('id, period_start, race_count', { count: 'exact' })
    .order('applied_at', { ascending: false })
    .limit(3);
  console.log(`  rows: ${whCount}, top 3:`, wh);

  console.log('\n=== predictions count (anon, pagination test) ===');
  // 처음 1000 fetch
  const { data: page1 } = await sb
    .from('predictions')
    .select('race_date, predicted_rank, actual_ord')
    .order('race_date')
    .order('meet')
    .order('rc_no')
    .range(0, 999);
  console.log(`  page 1: ${page1?.length} rows`);

  // 월별 group test
  const byMonth = new Map<string, { total: number; win: number }>();
  (page1 ?? []).forEach((r) => {
    if (r.predicted_rank !== 1 || r.actual_ord === null) return;
    const m = `${Math.floor(r.race_date / 10000)}-${String(Math.floor((r.race_date % 10000) / 100)).padStart(2, '0')}`;
    const e = byMonth.get(m) ?? { total: 0, win: 0 };
    e.total++;
    if (r.actual_ord === 1) e.win++;
    byMonth.set(m, e);
  });
  console.log('  월별 단승 적중률 (page 1만):');
  [...byMonth.entries()].sort().forEach(([m, v]) => {
    const pct = ((v.win / v.total) * 100).toFixed(1);
    console.log(`    ${m}: ${v.win}/${v.total} = ${pct}%`);
  });

  console.log('\n=== predictions count by predicted_rank=1 (anon) ===');
  const { count: arch } = await sb
    .from('predictions')
    .select('*', { count: 'exact', head: true })
    .eq('predicted_rank', 1);
  console.log(`  predicted_rank=1 rows: ${arch}`);
}
main().catch(console.error);
