/**
 * KRA API284 raw 응답 확인 (hr_no별로 정말 다른 값 오는지)
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;

async function test(hrNo: string, paramName: string = 'hr_no') {
  const params: Record<string, string | number> = {
    serviceKey: apiKey,
    pageNo: 1,
    numOfRows: 1,
    _type: 'json',
  };
  params[paramName] = hrNo;
  const { data } = await axios.get('https://apis.data.go.kr/B551015/API284/HorseBloodBasicInfo', {
    params,
  });
  const items = data?.response?.body?.items?.item;
  const arr = items ? (Array.isArray(items) ? items : [items]) : [];
  console.log(`\n=== ${hrNo} ===`);
  console.log(`totalCount: ${data?.response?.body?.totalCount}`);
  console.log(`items 수신: ${arr.length}`);
  if (arr.length > 0) {
    console.log(JSON.stringify(arr[0], null, 2));
  } else {
    console.log('items 없음, raw response:');
    console.log(JSON.stringify(data, null, 2).slice(0, 800));
  }
}

async function main() {
  console.log('## hr_no (snake_case)');
  await test('0047073', 'hr_no');
  console.log('\n## hrno (camelCase)');
  await new Promise((r) => setTimeout(r, 500));
  await test('0047073', 'hrno');
  console.log('\n## hrNo');
  await new Promise((r) => setTimeout(r, 500));
  await test('0047073', 'hrNo');
  console.log('\n## hr_name');
  await new Promise((r) => setTimeout(r, 500));
  await test('최강타임', 'hr_name');
}
main();
