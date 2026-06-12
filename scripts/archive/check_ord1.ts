import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from('horse_results').select('*').eq('race_date', 20260523).eq('meet', 1).eq('rc_no', 10).eq('ord', 1).maybeSingle();
  console.log('=== 1위 말 ===');
  console.log(JSON.stringify(data, null, 2));
}
main();
