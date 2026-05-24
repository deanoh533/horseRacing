import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb
    .from('races')
    .select('race_date')
    .order('race_date');
  const dates = Array.from(new Set((data ?? []).map((r) => r.race_date)));
  console.log(`총 ${dates.length}일 / ${data?.length}경주`);
  console.log(`최소: ${dates[0]}, 최대: ${dates[dates.length - 1]}`);
  console.log('전체 날짜:', dates.join(', '));
}
main();
