/**
 * jkpresult (jkpresult vs jkresult vs jkyresult — 어느 것?)
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

async function probe(label: string, path: string, params: Record<string, string | number>) {
  console.log(`\n========== ${label} ==========`);
  try {
    const { data } = await axios.get(BASE + path, {
      params: { serviceKey: apiKey, pageNo: 1, numOfRows: 3, _type: 'json', ...params },
      timeout: 20000,
    });
    const header = data?.response?.header;
    const items = data?.response?.body?.items?.item;
    const totalCount = data?.response?.body?.totalCount;
    console.log('header:', JSON.stringify(header));
    console.log('totalCount:', totalCount);
    if (items) {
      const arr = Array.isArray(items) ? items : [items];
      console.log(`수신 ${arr.length}건. 필드:`);
      console.log('  ' + Object.keys(arr[0]).join(', '));
      console.log('첫 row 샘플:');
      console.log(JSON.stringify(arr[0], null, 2));
    } else {
      console.log('items 없음. 응답 일부:');
      console.log(JSON.stringify(data, null, 2).slice(0, 800));
    }
  } catch (e) {
    const err = e as { message: string; response?: { status: number; data: unknown } };
    console.error('ERROR:', err.message, err.response?.status);
    if (err.response?.data) console.error(JSON.stringify(err.response.data).slice(0, 400));
  }
}

async function main() {
  // jkpresult 후보 경로들
  for (const path of [
    '/jkpresult/getjkpresult',
    '/jkpresult/jkpresult',
    '/jkpresult',
    '/jkpresult/getJkpResult',
  ]) {
    await probe(`jkpresult ${path}`, path, { meet: 1 });
  }
}
main().catch(console.error);
