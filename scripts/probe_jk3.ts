/**
 * jkresult 기수성적 파라미터 조합 탐색
 * npx tsx scripts/probe_jk3.ts
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

async function probe(label: string, url: string, params: Record<string, string | number>) {
  try {
    const { data } = await axios.get(url, {
      params: { serviceKey: apiKey, pageNo: 1, numOfRows: 2, _type: 'json', ...params },
      timeout: 15000,
    });
    const code = data?.response?.header?.resultCode;
    const count = data?.response?.body?.totalCount;
    const items = data?.response?.body?.items?.item;
    if (code === '00') {
      console.log(`[OK] ${label} | count=${count}`);
      if (items) {
        const arr = Array.isArray(items) ? items : [items];
        console.log('  FIELDS: ' + Object.keys(arr[0]).join(', '));
        console.log('  SAMPLE: ' + JSON.stringify(arr[0]).slice(0, 400));
      }
      return true;
    } else {
      console.log(`[FAIL code=${code}] ${label} | msg=${data?.response?.header?.resultMsg}`);
    }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } }).response?.status;
    const resData = (e as { response?: { data?: unknown } }).response?.data;
    const msg = (e as Error).message;
    console.log(`[${status ?? 'ERR'}] ${label} — ${msg.slice(0, 60)}`);
    if (resData) console.log('  body:', JSON.stringify(resData).slice(0, 200));
  }
  return false;
}

async function main() {
  // 500 반환 경로들의 파라미터 조합 시도
  const jkPaths = ['/jkresult/getJkResult', '/jkresult/jkResult', '/jkresult/jockeyResult'];
  const paramSets = [
    { meet: 1 },
    { jk_no: '051174', meet: 1 },
    { jkNo: '051174', meet: 1 },
    { jk_no: '051174' },
    { meet: 1, rc_date: 20260524 },
    {},  // no extra params
  ];
  for (const path of jkPaths) {
    console.log(`\n=== ${path} ===`);
    for (const p of paramSets) {
      await probe(JSON.stringify(p), BASE + path, p as Record<string, string | number>);
    }
  }

  // API6_1: 구독 확인 — 응답이 아예 다른 경로에 있는지 확인
  console.log('\n=== API6_1 다른 날짜/경주로 재확인 ===');
  const paths6 = [
    '/API6_1/raceResult_6',
    '/API6_1/sectionRecord_6',
  ];
  const dates = [20260517, 20260518, 20260510, 20260503];
  for (const path of paths6) {
    for (const rc_date of dates) {
      await probe(`${path} date=${rc_date}`, BASE + path, { meet: 1, rc_date, rc_no: 1 });
    }
  }
}

main().catch(console.error);
