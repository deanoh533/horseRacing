/**
 * horseinfohi batch fetch → horses 테이블
 *  - API: GET /horseinfohi/gethorseinfohi?hrno={hrno}
 *  - 응답에 sireHrnm (부마) / damHrnm (모마) / gndrNm (성별) / foalgDt (출생일) 등
 *
 *  rate limit 도달 시 안전 중단 + 진행 보고
 *  재실행 시 horses에 없는 hr_no만 fetch
 */
import 'dotenv/config';
import axios from 'axios';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import pLimit from 'p-limit';

const CONCURRENCY = 3;
const apiKey = process.env.KRA_API_KEY!;
const ENDPOINT = 'https://apis.data.go.kr/B551015/horseinfohi/gethorseinfohi';

interface HorseInfo {
  hrno: string;
  korHrnm: string;
  imphrEngHrnm?: string;
  foalgDt?: string;
  gndrNm?: string;
  pctyNm?: string;
  spcsNm?: string;
  sireHrnm?: string;
  damHrnm?: string;
}

async function fetchOne(hrno: string): Promise<HorseInfo | null> {
  const { data } = await axios.get(ENDPOINT, {
    params: { serviceKey: apiKey, hrno, pageNo: 1, numOfRows: 1, _type: 'json' },
    timeout: 15000,
  });
  const item = data?.response?.body?.items?.item;
  if (!item) return null;
  const obj = Array.isArray(item) ? item[0] : item;
  return obj as HorseInfo;
}

function parseFoalgDt(raw: string | undefined): string | null {
  // "2021-02-18(5세)" → "2021-02-18"
  if (!raw || raw === '-') return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseFoalYear(raw: string | undefined): number | null {
  const dt = parseFoalgDt(raw);
  return dt ? Number(dt.slice(0, 4)) * 10000 + Number(dt.slice(5, 7)) * 100 + Number(dt.slice(8, 10)) : null;
}

async function main() {
  const sb = getSupabaseAdmin();

  console.log('[1/3] horse_results의 unique hr_no 수집...');
  const hrNos = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('horse_results')
      .select('hr_no')
      .order('hr_no')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    data.forEach((r) => hrNos.add(r.hr_no));
    if (data.length < 1000) break;
  }
  console.log(`  unique: ${hrNos.size}`);

  console.log('[2/3] horses 테이블에 이미 있는 것 제외...');
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
    console.log('✅ 모두 완료');
    return;
  }

  console.log('\n[3/3] horseinfohi 호출 + horses upsert...');
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let success = 0;
  let notFound = 0;
  let rateLimited = false;
  const startedAt = Date.now();

  await Promise.all(
    todo.map((hrno) =>
      limit(async () => {
        if (rateLimited) return;
        try {
          const info = await fetchOne(hrno);
          if (!info || !info.hrno) {
            notFound++;
          } else {
            const { error } = await sb.from('horses').upsert({
              hr_no: info.hrno,
              hr_name: info.korHrnm ?? '',
              eng_hr_name: info.imphrEngHrnm && info.imphrEngHrnm !== '-' ? info.imphrEngHrnm : null,
              birthday: parseFoalYear(info.foalgDt),
              foalg_dt: parseFoalgDt(info.foalgDt),
              sex: info.gndrNm ?? null,
              pcty_nm: info.pctyNm ?? null,
              spcs_nm: info.spcsNm ?? null,
              sire_hr_nm: info.sireHrnm && info.sireHrnm !== '-' ? info.sireHrnm : null,
              dam_hr_nm: info.damHrnm && info.damHrnm !== '-' ? info.damHrnm : null,
              last_updated: new Date().toISOString(),
            });
            if (error) {
              console.warn(`  ⚠️ upsert ${hrno}: ${error.message.slice(0, 80)}`);
            } else {
              success++;
            }
          }
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.includes('429') || msg.includes('LIMITED_NUMBER') || msg.includes('SERVICE_KEY')) {
            if (!rateLimited) {
              console.error(`\n❌ KRA rate limit 도달 (${done}건 처리 후)`);
              rateLimited = true;
            }
          } else if (done < 5) {
            console.warn(`  ⚠️ ${hrno}: ${msg.slice(0, 100)}`);
          }
        } finally {
          done++;
          if (done % 100 === 0) {
            const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
            const pct = ((done / todo.length) * 100).toFixed(0);
            console.log(`  진행 ${done}/${todo.length} (${pct}%) — 성공 ${success}, 없음 ${notFound}, ${elapsed}s`);
          }
        }
      })
    )
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n✅ 종료: 처리 ${done} / 성공 ${success} / 데이터 없음 ${notFound} / ${elapsed}s`);
  if (rateLimited) {
    console.log('⚠️ Rate limit으로 중단됨. 내일 재실행 (이미 채워진 hr_no는 skip).');
  }
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
