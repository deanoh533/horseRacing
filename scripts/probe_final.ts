/**
 * 최종 probe: jkyresult/getjkyresult + API37_1/sectionRecord_1
 * npx tsx scripts/probe_final.ts
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

async function probe(label: string, url: string, params: Record<string, string | number>) {
  try {
    const res = await axios.get(url, {
      params: { serviceKey: apiKey, pageNo: 1, numOfRows: 3, _type: 'json', ...params },
      timeout: 15000,
    });
    const data = res.data;
    const code = data?.response?.header?.resultCode;
    const msg = data?.response?.header?.resultMsg;
    const count = data?.response?.body?.totalCount;
    const items = data?.response?.body?.items?.item;
    if (code === '00') {
      console.log(`[OK] ${label} | count=${count}`);
      if (items) {
        const arr = Array.isArray(items) ? items : [items];
        console.log('  FIELDS: ' + Object.keys(arr[0]).join(', '));
        console.log('  SAMPLE: ' + JSON.stringify(arr[0]));
      } else {
        console.log('  items: 없음 (count=0?)');
      }
    } else {
      console.log(`[FAIL code=${code} msg=${msg}] ${label}`);
    }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } }).response?.status;
    const resData = (e as { response?: { data?: unknown } }).response?.data;
    const msg = (e as Error).message;
    console.log(`[HTTP ${status ?? 'ERR'}] ${label} — ${msg.slice(0, 80)}`);
    if (resData) console.log('  body:', JSON.stringify(resData).slice(0, 300));
  }
}

async function main() {
  console.log('=== 1. jkyresult/getjkyresult (기수 성적 최근 1년) ===');
  // meet 만으로 호출
  await probe('jkyresult — meet=1 only', BASE + '/jkyresult/getjkyresult', { meet: 1 });
  await probe('jkyresult — meet=2 only', BASE + '/jkyresult/getjkyresult', { meet: 2 });
  await probe('jkyresult — meet=3 only', BASE + '/jkyresult/getjkyresult', { meet: 3 });
  // jk_no 포함
  await probe('jkyresult — jk_no+meet=1', BASE + '/jkyresult/getjkyresult', { meet: 1, jk_no: '051174' });
  // no params
  await probe('jkyresult — no extra params', BASE + '/jkyresult/getjkyresult', {});

  console.log('\n=== 2. 기수 성적 정보 API11_1 후보 ===');
  await probe('API11_1/jockeyResult_1 meet=1', BASE + '/API11_1/jockeyResult_1', { meet: 1 });
  await probe('API12_1/jockeyInfo_1 meet=1', BASE + '/API12_1/jockeyInfo_1', { meet: 1 });

  console.log('\n=== 3. API37_1/sectionRecord_1 (구간별 기록) ===');
  // 과거 경주 날짜 사용
  await probe('API37_1 — 20260517 R1', BASE + '/API37_1/sectionRecord_1', { meet: 1, rc_date: 20260517, rc_no: 1 });
  await probe('API37_1 — 20260510 R1', BASE + '/API37_1/sectionRecord_1', { meet: 1, rc_date: 20260510, rc_no: 1 });
  await probe('API37_1 — hr_no param', BASE + '/API37_1/sectionRecord_1', { meet: 1, rc_date: 20260517, hr_no: '2020124' });

  console.log('\n=== 4. 기수 상세정보 (jkinfo 계열) ===');
  await probe('jkinfo/getjkinfo meet=1', BASE + '/jkinfo/getjkinfo', { meet: 1 });
  await probe('jockeyinfo/getjockeyinfo meet=1', BASE + '/jockeyinfo/getjockeyinfo', { meet: 1 });
}

main().catch(console.error);
