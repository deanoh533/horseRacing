/**
 * API214_1에 이미 포함된 구간기록 필드 샘플 확인
 * npx tsx scripts/probe_sectional_fields.ts
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

async function main() {
  const { data } = await axios.get(BASE + '/API214_1/RaceDetailResult_1', {
    params: {
      serviceKey: apiKey,
      meet: 1,
      rc_date: 20260517,
      rc_no: 1,
      pageNo: 1,
      numOfRows: 2,
      _type: 'json',
    },
    timeout: 15000,
  });

  const items = data?.response?.body?.items?.item;
  const arr = Array.isArray(items) ? items : [items];
  const row = arr[0];

  console.log('=== API214_1 구간기록 관련 필드 전체 ===');
  // 구간기록 관련 필드만 필터
  const sectFields = Object.entries(row).filter(([k]) =>
    k.startsWith('bu') || k.startsWith('se') || k.startsWith('je') || k.startsWith('sj')
  );
  for (const [k, v] of sectFields) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\n=== 기타 주요 필드 ===');
  const mainFields = ['rcDate','rcNo','meet','hrName','hrNo','chulNo','ord','rcDist','rcTime','wgHr','wgJk','wgBudam'];
  for (const k of mainFields) {
    console.log(`  ${k}: ${row[k]}`);
  }

  console.log('\n=== 전체 row (참고) ===');
  console.log(JSON.stringify(row, null, 2));
}

main().catch(console.error);
