/**
 * 혈통 데이터 batch fetch
 *  - horse_results의 unique hr_no 추출
 *  - KRA API284 (BloodInfo) 호출
 *  - horses 테이블에 upsert
 *
 *  rate limit: KRA 일일 한도 도달 시 429 → 중단 + 진행 보고
 *  진행 상황 100마리마다 출력
 *  중단/재시작 안전: 이미 horses에 있는 hr_no는 skip
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { getKRAClient } from '../src/kra/client.js';
import pLimit from 'p-limit';

const CONCURRENCY = 3; // KRA client에 이미 p-limit(5)이지만 보수적으로 더 좁힘

async function main() {
  const sb = getSupabaseAdmin();
  const kra = getKRAClient();

  console.log('[1/3] race_entries의 unique hr_no 수집...');
  const hrNos = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('race_entries')
      .select('hr_no')
      .not('hr_no', 'is', null)
      .order('hr_no')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    data.forEach((r) => { if (r.hr_no) hrNos.add(r.hr_no); });
    if (data.length < 1000) break;
  }
  console.log(`  unique: ${hrNos.size}`);

  console.log('[2/3] horses 테이블의 기존 hr_no 제외...');
  const existing = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('horses')
      .select('hr_no')
      .order('hr_no')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    data.forEach((r) => existing.add(r.hr_no));
    if (data.length < 1000) break;
  }
  console.log(`  기존: ${existing.size}`);

  const todo = [...hrNos].filter((h) => !existing.has(h));
  console.log(`  fetch 대상: ${todo.length}`);

  if (todo.length === 0) {
    console.log('✅ 모두 완료된 상태');
    return;
  }

  console.log('\n[3/3] KRA API284 호출 + horses upsert...');
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let success = 0;
  let notFound = 0;
  let rateLimited = false;
  const startedAt = Date.now();

  await Promise.all(
    todo.map((hrNo) =>
      limit(async () => {
        if (rateLimited) return; // 한도 도달 시 나머지 skip

        try {
          const info = await kra.getBloodInfo(hrNo);
          if (!info) {
            notFound++;
          } else {
            // horses upsert
            const { error } = await sb.from('horses').upsert({
              hr_no: info.hrno,
              hr_name: info.korHrnm,
              eng_hr_name: info.engHrnm ?? null,
              foalg_dt: info.foalgDt ? formatFoalDate(info.foalgDt) : null,
              dsa_bri_vl: info.dsaBriVl ?? null,
              dsa_clc_vl: info.dsaClcVl ?? null,
              dsa_ier_vl: info.dsaIerVl ?? null,
              dsa_prf_vl: info.dsaPrfVl ?? null,
              dsa_coi_rt: info.dsaCoiRt ?? null,
              dsidx_vl: info.dsidxVl ?? null,
              last_updated: new Date().toISOString(),
            });
            if (error) {
              console.warn(`  ⚠️ upsert 실패 ${hrNo}: ${error.message}`);
            } else {
              success++;
            }
          }
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.includes('429') || msg.includes('LIMITED_NUMBER')) {
            if (!rateLimited) {
              console.error(`\n❌ KRA rate limit 도달 (${done}건 처리 후)`);
              console.error(`  남은 일일 한도 소진. 내일 다시 실행.`);
              rateLimited = true;
            }
          } else {
            console.warn(`  ⚠️ ${hrNo}: ${msg.slice(0, 80)}`);
          }
        } finally {
          done++;
          if (done % 100 === 0) {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
            const pct = ((done / todo.length) * 100).toFixed(0);
            console.log(`  진행 ${done}/${todo.length} (${pct}%) — 성공 ${success}, 없음 ${notFound}, ${elapsed}s 경과`);
          }
        }
      })
    )
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n✅ 종료: 처리 ${done} / 성공 ${success} / 데이터 없음 ${notFound} / ${elapsed}s`);
  if (rateLimited) {
    console.log('⚠️ Rate limit으로 중단됨. 내일 재실행하면 horses 테이블에 없는 hr_no만 다시 fetch.');
  }
}

function formatFoalDate(foalg: number): string {
  // YYYYMMDD → YYYY-MM-DD
  const s = String(foalg);
  if (s.length !== 8) return new Date().toISOString().slice(0, 10);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
