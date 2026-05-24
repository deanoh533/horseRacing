import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { count: races } = await sb.from('races').select('*', { count: 'exact', head: true });
  const { count: horses } = await sb.from('horse_results').select('*', { count: 'exact', head: true });
  const { count: preds } = await sb.from('predictions').select('*', { count: 'exact', head: true });

  const { data: dMin } = await sb.from('races').select('race_date').order('race_date').limit(1);
  const { data: dMax } = await sb.from('races').select('race_date').order('race_date', { ascending: false }).limit(1);

  console.log(`📊 동기화 누적 현황`);
  console.log(`  races          ${races} 건`);
  console.log(`  horse_results  ${horses} 건`);
  console.log(`  predictions    ${preds} 건  (재계산 필요)`);
  console.log(`  기간           ${dMin?.[0]?.race_date} ~ ${dMax?.[0]?.race_date}`);
}
main();
