import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await sb
    .from('predictions')
    .select('hr_name, total_score, predicted_rank, actual_ord')
    .eq('race_date', 20260523)
    .eq('meet', 1)
    .eq('rc_no', 10)
    .order('predicted_rank');
  if (error) throw error;

  console.log('\n=== 2026-05-23 서울 10R 예측 결과 ===\n');
  console.log('순위 | 마명          | 종합점수 | 실제착순 | 적중');
  console.log('-'.repeat(60));
  (data ?? []).forEach((p) => {
    const hit = p.predicted_rank === p.actual_ord ? '✓' : '';
    console.log(
      `  ${String(p.predicted_rank).padStart(2)} | ${p.hr_name.padEnd(13)} | ${String(p.total_score).padStart(6)} | ${String(p.actual_ord ?? '?').padStart(2)}위    | ${hit}`
    );
  });

  // 전체 통계
  const { count } = await sb.from('predictions').select('*', { count: 'exact', head: true });
  console.log(`\n전체 predictions 행: ${count}`);

  // 적중률 (간단)
  const { data: all } = await sb
    .from('predictions')
    .select('predicted_rank, actual_ord');
  const valid = (all ?? []).filter((p) => p.actual_ord != null);
  const hit1 = valid.filter((p) => p.predicted_rank === 1 && p.actual_ord === 1).length;
  const totalRaces = new Set(
    (all ?? []).map((p: any) => `${p.race_date}-${p.meet}-${p.rc_no}`)
  ).size;
  console.log(`\n1위 적중 (예측 1위 == 실제 1위): ${hit1}경주`);
}
main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
