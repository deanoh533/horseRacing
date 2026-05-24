/**
 * 미래 경기 날짜로 KRA 호출 시 사전 데이터(출주표) 받을 수 있는지 확인
 */
import 'dotenv/config';
import axios from 'axios';

const BASE = 'https://apis.data.go.kr/B551015';
const apiKey = process.env.KRA_API_KEY!;

const FUTURE_DATES = [
  20260530, // 다음 주말 (보통 토)
  20260531, // 일
  20260606, // 그 다음 주
];

async function test(endpoint: string, name: string) {
  console.log(`\n=== ${name} ===`);
  for (const date of FUTURE_DATES) {
    try {
      const { data, status } = await axios.get(`${BASE}${endpoint}`, {
        params: {
          serviceKey: apiKey,
          meet: 1,
          rc_date: date,
          rc_no: 1,
          pageNo: 1,
          numOfRows: 5,
          _type: 'json',
        },
        timeout: 10000,
        validateStatus: () => true,
      });
      const items = data?.response?.body?.items?.item;
      const has = items ? (Array.isArray(items) ? items.length : 1) : 0;
      console.log(`  ${date} [${status}] items=${has}`);
      if (has > 0) {
        const sample = Array.isArray(items) ? items[0] : items;
        console.log(`    필드: ${Object.keys(sample).join(', ')}`);
        console.log(`    샘플: hr=${sample.hrName} stOrd=${sample.stOrd} rcTime=${sample.rcTime}`);
      }
    } catch (e) {
      console.log(`  ${date} ERR ${(e as Error).message.slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  await test('/racedetailresult/getracedetailresult', 'racedetailresult (현재 사용)');
  await test('/API214_1/RaceDetailResult_1', 'API214_1');
}
main();
