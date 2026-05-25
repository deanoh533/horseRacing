/**
 * KRA API284 호출 + 응답 형식 확인 (소수 샘플)
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { getKRAClient } from '../src/kra/client.js';

async function main() {
  const sb = getSupabaseAdmin();
  const kra = getKRAClient();

  // 5개만 시도
  const { data } = await sb
    .from('horse_results')
    .select('hr_no, hr_name')
    .limit(5);

  console.log('샘플 5마리 혈통 fetch:\n');
  for (const h of data ?? []) {
    try {
      const info = await kra.getBloodInfo(h.hr_no);
      if (!info) {
        console.log(`  ${h.hr_name} (${h.hr_no}): 데이터 없음`);
      } else {
        console.log(`  ${h.hr_name} (${h.hr_no})`);
        console.log(`    dsaBriVl=${info.dsaBriVl} dsaClcVl=${info.dsaClcVl} dsidxVl=${info.dsidxVl}`);
        console.log(`    foalgDt=${info.foalgDt}`);
      }
    } catch (e) {
      console.log(`  ${h.hr_name} (${h.hr_no}): 에러 ${(e as Error).message.slice(0, 80)}`);
    }
  }
}
main().catch(console.error);
