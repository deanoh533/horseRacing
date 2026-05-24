/**
 * KRA 출주표 API 실호출 + pthrNo 정체 검증
 *
 * - 서울 (API314/textDataHoldSePtinInfo)
 * - 부산경남 (API316/textDataHoldBuPtinInfo)
 *
 * 5/23 (이미 결과 있는 날) 호출해서 우리 horse_results와 비교
 *   - pthrNo가 chul_no와 같은지 / ord와 같은지 / 다른 값인지
 */
import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const apiKey = process.env.KRA_API_KEY!;

async function fetchRaceCard(meetUrl: string, rcDate: number, rcNo: number) {
  const { data } = await axios.get(meetUrl, {
    params: {
      serviceKey: apiKey,
      race_dt: rcDate, // API 명세: race_dt (rc_date 아님)
      race_no: rcNo,   // API 명세: race_no (rc_no 아님)
      pageNo: 1,
      numOfRows: 50,
      _type: 'json',
    },
    timeout: 15000,
  });
  const items = data?.response?.body?.items?.item;
  return items ? (Array.isArray(items) ? items : [items]) : [];
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. 서울 5/23 1R 출주표
  console.log('=== 서울 (API314) 5/23 1R ===');
  const seoul = await fetchRaceCard(
    'https://apis.data.go.kr/B551015/API314/textDataHoldSePtinInfo',
    20260523,
    1
  );
  console.log(`수신 ${seoul.length}건`);
  if (seoul.length > 0) {
    console.log('필드:', Object.keys(seoul[0]).join(', '));
    console.log('\n샘플 row (전체):');
    console.log(JSON.stringify(seoul[0], null, 2));
  }

  // 2. 우리 DB의 같은 경주 (chul_no, ord, st_ord 비교)
  console.log('\n=== 우리 DB: 서울 5/23 1R ===');
  const { data: dbRows } = await sb
    .from('horse_results')
    .select('chul_no, st_ord, ord, hr_name, hr_no')
    .eq('race_date', 20260523)
    .eq('meet', 1)
    .eq('rc_no', 1)
    .order('chul_no');
  console.log('chul_no | st_ord | ord | hr_name');
  dbRows?.forEach((r) =>
    console.log(`  ${String(r.chul_no).padStart(2)}    |  ${String(r.st_ord ?? '?').padStart(2)}    | ${String(r.ord ?? '?').padStart(2)} | ${r.hr_name}`)
  );

  // 3. 출주표의 pthrNo vs DB의 chul_no/ord 비교
  if (seoul.length > 0 && dbRows) {
    console.log('\n=== pthrNo vs chul_no/ord ===');
    console.log('마명             | pthrNo | chul_no | ord');
    for (const card of seoul) {
      const db = dbRows.find((d) => d.hr_name === card.hrnm);
      console.log(
        `  ${(card.hrnm ?? '').padEnd(15)}|  ${String(card.pthrNo).padStart(3)}   |  ${String(db?.chul_no ?? '?').padStart(3)}    | ${String(db?.ord ?? '?').padStart(2)}`
      );
    }
  }
}
main().catch((e) => {
  console.error('💥', (e as Error).message);
  if ((e as any).response) {
    console.error('  응답:', JSON.stringify((e as any).response.data).slice(0, 500));
  }
});
