import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  // 실제 데이터 한 건의 모든 컬럼 확인
  const { data: race } = await sb.from('races').select('*').eq('race_date', 20260523).eq('meet', 1).eq('rc_no', 10).maybeSingle();
  console.log('=== races 컬럼 ===');
  console.log(JSON.stringify(race, null, 2));
  
  const { data: horses } = await sb.from('horse_results').select('*').eq('race_date', 20260523).eq('meet', 1).eq('rc_no', 10).limit(1);
  console.log('\n=== horse_results 컬럼 (1 row) ===');
  console.log(JSON.stringify(horses?.[0], null, 2));
}
main();
