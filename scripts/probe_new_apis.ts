/**
 * KRA 신규 API 3개 (API6_1, API18_1, jkpresult) 응답 필드 탐색용 probe
 *
 * 사용: npx tsx scripts/probe_new_apis.ts
 *
 * 목적: 실제 응답을 찍어보고 필드명 (camelCase 등) 확인 후 client.ts에 반영
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

async function probe(label: string, url: string, params: Record<string, string | number>) {
  console.log(`\n========== ${label} ==========`);
  console.log(`URL: ${url}`);
  console.log(`Params:`, params);
  try {
    const { data } = await axios.get(url, {
      params: { serviceKey: apiKey, pageNo: 1, numOfRows: 2, _type: 'json', ...params },
      timeout: 20000,
    });
    const header = data?.response?.header;
    const items = data?.response?.body?.items?.item;
    const totalCount = data?.response?.body?.totalCount;
    console.log(`header:`, header);
    console.log(`totalCount:`, totalCount);
    if (items) {
      const arr = Array.isArray(items) ? items : [items];
      console.log(`수신 ${arr.length}건. 첫 row 필드명:`);
      console.log('  ' + Object.keys(arr[0]).join(', '));
      console.log(`첫 row 전체:`);
      console.log(JSON.stringify(arr[0], null, 2));
    } else {
      console.log('items 없음. 응답 전체:');
      console.log(JSON.stringify(data, null, 2).slice(0, 1500));
    }
  } catch (e) {
    console.error('ERROR:', (e as Error).message);
  }
}

async function main() {
  // ─── API6_1: 구간별 경주 기록 ───────────────────────────────
  // 후보 URL: raceResult_6, raceSectionRecord, sectionalRecord 등 — 여러 패턴 시도
  for (const path of ['/API6_1/raceResult_6', '/API6_1/raceSection_6', '/API6_1/sectionRecord_6']) {
    await probe(`API6_1 ${path}`, BASE + path, {
      meet: 1,
      rc_date: 20260524,
      rc_no: 1,
    });
  }

  // ─── API18_1: 일별 훈련 ─────────────────────────────────────
  await probe('API18_1 dailyTraining_1', BASE + '/API18_1/dailyTraining_1', {
    meet: 1,
    tr_date: 20260520,
  });

  // ─── jkpresult: 기수 성적 ────────────────────────────────────
  for (const path of ['/jkpresult/jockeyResult', '/jkpresult/getJockeyResult', '/jkpresult']) {
    await probe(`jkpresult ${path}`, BASE + path, { meet: 1 });
  }
}

main().catch(console.error);
