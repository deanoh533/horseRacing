/**
 * API6_1 구간기록 & jkpresult 기수성적 URL 후보 탐색
 * npx tsx scripts/probe_api6_jk.ts
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
        console.log('  SAMPLE: ' + JSON.stringify(arr[0]).slice(0, 200));
      } else {
        console.log('  items 없음');
      }
    } else {
      console.log(`[FAIL code=${code}] ${label}`);
    }
  } catch (e: unknown) {
    const msg = (e as Error).message;
    const status = (e as { response?: { status?: number } }).response?.status;
    console.log(`[ERR ${status ?? '?'}] ${label} — ${msg.slice(0, 60)}`);
  }
}

async function main() {
  console.log('=== API6_1 구간기록 URL 후보 ===');
  const api6Paths = [
    '/API6_1/raceRecord_6',
    '/API6_1/sectionRecord_6',
    '/API6_1/sectionTime_6',
    '/API6_1/raceSect_6',
    '/API6_1/sectTime_6',
    '/API6_1/raceSection_6',
    '/API37_1/sectionRecord_1',       // 웹검색 결과 힌트
    '/API37_1/raceRecord_37',
    '/API4_3/sectionRecord_3',
    '/API214_1/sectionRecord_214',
  ];
  const p6 = { meet: 1, rc_date: 20260524, rc_no: 1 };
  for (const path of api6Paths) {
    await probe(`API6_1 ${path}`, BASE + path, p6);
  }

  console.log('\n=== jkpresult 기수성적 URL 후보 ===');
  const jkPaths = [
    '/jkpresult/jockeyResult',
    '/jkpresult/getJockeyResult',
    '/jkpresult/jkResult',
    '/jkpresult/jkInfo',
    '/jkpresult/getRaceResult',
    '/API_JKResult/jockeyResult',
    '/jockey/getjockeyinfo',
    '/jockeyinfo/getjockeyinfo',
    '/jockeystats/getJockeyStats',
    '/API_JK/jockeyResult',
  ];
  for (const path of jkPaths) {
    await probe(`jk ${path}`, BASE + path, { meet: 1 });
  }
}

main().catch(console.error);
