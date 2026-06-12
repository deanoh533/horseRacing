import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  const { data, error } = await sb.rpc('exec_sql', {
    sql: `SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`
  }).select();
  
  if (error) {
    // RPC 없으면 직접 metadata 쿼리
    const { data: tables } = await sb
      .from('pg_tables' as any)
      .select('tablename')
      .eq('schemaname', 'public');
    console.log('직접 쿼리:', tables);
  } else {
    console.log(data);
  }
}
main();
