/**
 * 비주파 ord (≥ 90) 정제
 * - ord: NULL
 * - rc_time: 0 인 행도 NULL 로
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. ord ≥ 90 → NULL
  const { data: before } = await sb
    .from('horse_results')
    .select('race_date, meet, rc_no, chul_no', { count: 'exact' })
    .gte('ord', 90);
  console.log(`정제 대상: ${before?.length ?? 0}건`);

  const { error: e1 } = await sb
    .from('horse_results')
    .update({ ord: null })
    .gte('ord', 90);
  if (e1) throw e1;
  console.log('✅ ord ≥ 90 → NULL 완료');

  // 2. rc_time = 0 → NULL
  const { error: e2 } = await sb
    .from('horse_results')
    .update({ rc_time: null })
    .eq('rc_time', 0);
  if (e2) throw e2;
  console.log('✅ rc_time = 0 → NULL 완료');

  // 검증
  const { count: stillAbnormal } = await sb
    .from('horse_results')
    .select('*', { count: 'exact', head: true })
    .gte('ord', 90);
  console.log(`\n남은 비정상 ord: ${stillAbnormal}건`);
}
main().catch(console.error);
