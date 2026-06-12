import 'dotenv/config';
import axios from 'axios';

const KEY = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';
const PARAMS = { serviceKey: KEY, meet: 1, rc_date: 20260523, pageNo: 1, numOfRows: 1, _type: 'json' };

async function getFields(path: string) {
  const { data } = await axios.get(`${BASE}${path}`, { params: PARAMS, timeout: 15000 });
  const item = data.response.body.items.item;
  const r = Array.isArray(item) ? item[0] : item;
  return r as Record<string, unknown>;
}

const [r214, r4_3] = await Promise.all([
  getFields('/API214_1/RaceDetailResult_1'),
  getFields('/API4_3/raceResult_3'),
]);

const fields214 = new Set(Object.keys(r214));
const fields4_3 = new Set(Object.keys(r4_3));

const onlyIn4_3 = [...fields4_3].filter(f => !fields214.has(f));
const onlyIn214 = [...fields214].filter(f => !fields4_3.has(f));

console.log(`\nAPI214_1 필드 수: ${fields214.size}`);
console.log(`API4_3   필드 수: ${fields4_3.size}`);

console.log('\n[API4_3에만 있는 필드]', onlyIn4_3.length > 0 ? onlyIn4_3.join(', ') : '없음');
console.log('\n[API214_1에만 있는 필드]', onlyIn214.length > 0 ? onlyIn214.join(', ') : '없음');

if (onlyIn4_3.length > 0) {
  console.log('\n[API4_3 추가 필드 값]');
  for (const f of onlyIn4_3) {
    console.log(`  ${f}: ${r4_3[f]}`);
  }
}
