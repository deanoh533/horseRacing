import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // horse_results의 unique hr_no
  const all: string[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('horse_results')
      .select('hr_no')
      .order('hr_no')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data.map((r) => r.hr_no));
    if (data.length < 1000) break;
  }
  const unique = new Set(all);
  console.log(`총 출전 row: ${all.length}`);
  console.log(`unique hr_no: ${unique.size}`);

  // horses 테이블에 이미 있는 것
  const { count: existingCount } = await sb
    .from('horses')
    .select('*', { count: 'exact', head: true });
  console.log(`horses 테이블 기존: ${existingCount}`);

  // 추정 작업량: KRA API284 호출 (말당 1회), 200ms 가정 → 시간 추정
  const estSec = (unique.size * 0.3).toFixed(0);
  console.log(`예상 소요 시간: ${unique.size} × 0.3s = ${estSec}s = ${(Number(estSec) / 60).toFixed(0)}분`);
}
main().catch(console.error);
