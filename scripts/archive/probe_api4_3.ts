/**
 * API4_3/raceResult_3 probe
 *
 * 목적:
 *   1. 실제 응답 필드 확인 (API214_1과 비교)
 *   2. 말 단위 row인지 / 경주 단위 row인지 확인
 *   3. API214_1에 없는 추가 필드 파악
 *
 * 실행: npx tsx scripts/probe_api4_3.ts
 */
import 'dotenv/config';
import axios from 'axios';

const API_KEY = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

// API214_1이 반환하는 주요 필드 (비교용)
const API214_KNOWN_FIELDS = new Set([
  'meet', 'rcDate', 'rcNo', 'chulNo', 'hrNo', 'hrName', 'ord',
  'rcTime', 'burdWgt', 'jkNo', 'jkName', 'trNo', 'trName',
  'seG1fAccTime', 'seG3fAccTime', 'seS1fAccTime', 'se_3cAccTime', 'se_4cAccTime',
  'sjG1fOrd', 'sjG3fOrd', 'sjS1fOrd',
  'buG1fAccTime', 'buG2fAccTime', 'buG3fAccTime', 'buG4fAccTime',
  'buG6fAccTime', 'buG8fAccTime', 'buS1fAccTime',
]);

async function probe(path: string, params: Record<string, string | number>) {
  const { data } = await axios.get(`${BASE}${path}`, {
    params: { serviceKey: API_KEY, _type: 'json', ...params },
    timeout: 15_000,
  });
  const header = data?.response?.header;
  const body = data?.response?.body;
  if (header?.resultCode !== '00') {
    console.log(`  ❌ ${header?.resultCode}: ${header?.resultMsg}`);
    return null;
  }
  const items = body?.items?.item;
  if (!items) {
    console.log(`  totalCount=${body?.totalCount ?? 0} — 결과 없음`);
    return null;
  }
  const rows = Array.isArray(items) ? items : [items];
  console.log(`  totalCount=${body?.totalCount}, 수신 ${rows.length}건`);
  return rows;
}

async function main() {
  // 1. raceResult_3 — 기본 오퍼레이션
  console.log('\n=== API4_3/raceResult_3 (서울 20260523) ===');
  const rows = await probe('/API4_3/raceResult_3', {
    meet: 1,
    rc_date: 20260523,
    pageNo: 1,
    numOfRows: 5,
  });

  if (rows && rows.length > 0) {
    const fields = Object.keys(rows[0]);
    console.log('\n[전체 필드]', fields.join(', '));

    // API214_1에 없는 신규 필드 강조
    const newFields = fields.filter(f => !API214_KNOWN_FIELDS.has(f));
    console.log('\n[API214_1 대비 추가 필드]', newFields.length > 0 ? newFields.join(', ') : '없음');

    console.log('\n[샘플 1행]');
    console.log(JSON.stringify(rows[0], null, 2));
  }

  // 2. rc_no 필터 동작 확인
  console.log('\n=== rc_no 필터 테스트 (1R만) ===');
  const filtered = await probe('/API4_3/raceResult_3', {
    meet: 1,
    rc_date: 20260523,
    rc_no: 1,
    pageNo: 1,
    numOfRows: 20,
  });
  if (filtered) {
    const rcNos = [...new Set(filtered.map((r: any) => r.rcNo ?? r.rc_no ?? '?'))];
    console.log('  반환된 rcNo 값:', rcNos.join(', '));
  }

  // 3. 부경(meet=3) 지원 여부
  console.log('\n=== 부경(meet=3) 지원 확인 ===');
  await probe('/API4_3/raceResult_3', {
    meet: 3,
    rc_date: 20260523,
    pageNo: 1,
    numOfRows: 5,
  });

  // 4. 혹시 다른 오퍼레이션이 있는지 탐색
  const altOps = ['raceResult_1', 'raceResult_2', 'raceResult_4', 'RaceResult_3'];
  console.log('\n=== 대체 오퍼레이션 탐색 ===');
  for (const op of altOps) {
    process.stdout.write(`  /API4_3/${op} ... `);
    try {
      const r = await probe(`/API4_3/${op}`, {
        meet: 1, rc_date: 20260523, pageNo: 1, numOfRows: 1,
      });
      if (r) console.log('✅ 응답 있음');
    } catch (e: any) {
      console.log(`❌ ${e?.response?.status ?? e.message}`);
    }
  }
}

main().catch((e) => {
  console.error('💥', e.message);
  if (e.response) console.error('  응답:', JSON.stringify(e.response.data).slice(0, 500));
});
