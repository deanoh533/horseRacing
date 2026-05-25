/**
 * KRA horseinfohi API 시도 (API284 대체)
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;

async function test(label: string, params: Record<string, string | number>) {
  console.log(`\n=== ${label} ===`);
  try {
    const { data } = await axios.get('https://apis.data.go.kr/B551015/horseinfohi/gethorseinfohi', {
      params: {
        serviceKey: apiKey,
        pageNo: 1,
        numOfRows: 2,
        _type: 'json',
        ...params,
      },
      timeout: 10000,
    });
    const items = data?.response?.body?.items?.item;
    const total = data?.response?.body?.totalCount;
    console.log(`totalCount: ${total}`);
    const arr = items ? (Array.isArray(items) ? items : [items]) : [];
    if (arr.length > 0) {
      console.log(`필드: ${Object.keys(arr[0]).join(', ')}`);
      console.log(JSON.stringify(arr[0], null, 2).slice(0, 600));
    } else {
      console.log('items 없음');
    }
  } catch (e) {
    console.log(`ERR: ${(e as Error).message.slice(0, 100)}`);
  }
}

async function main() {
  await test('hr_no=0047073', { hr_no: '0047073' });
  await new Promise((r) => setTimeout(r, 500));
  await test('hrno=0047073', { hrno: '0047073' });
  await new Promise((r) => setTimeout(r, 500));
  await test('hr_name=최강타임', { hr_name: '최강타임' });
  await new Promise((r) => setTimeout(r, 500));
  await test('hrName=최강타임', { hrName: '최강타임' });
  await new Promise((r) => setTimeout(r, 500));
  await test('hrName=엔딩파이어', { hrName: '엔딩파이어' });
}
main();
