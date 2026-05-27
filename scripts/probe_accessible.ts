/**
 * 현재 API 키로 접근 가능한 엔드포인트 확인
 * npx tsx scripts/probe_accessible.ts
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

async function probe(label: string, path: string, params: Record<string, string | number>) {
  try {
    const res = await axios.get(BASE + path, {
      params: { serviceKey: apiKey, pageNo: 1, numOfRows: 1, _type: 'json', ...params },
      timeout: 10000,
    });
    const code = res.data?.response?.header?.resultCode;
    const msg = res.data?.response?.header?.resultMsg;
    const count = res.data?.response?.body?.totalCount;
    if (code === '00') {
      const items = res.data?.response?.body?.items?.item;
      const fields = items ? (Array.isArray(items) ? Object.keys(items[0]) : Object.keys(items)) : [];
      console.log(`[OK] ${label} count=${count} fields=${fields.join(',')}`);
      return 'ok';
    } else {
      console.log(`[FAIL ${code}] ${label} — ${msg}`);
      return 'fail';
    }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } }).response?.status;
    console.log(`[${status ?? 'ERR'}] ${label}`);
    return status === 403 ? 'forbidden' : 'error';
  }
}

async function main() {
  const PREV_RACE = { meet: 1, rc_date: 20260517, rc_no: 1 };

  console.log('=== 현재 키로 접근 가능한 API 확인 ===\n');

  // 이미 작동하는 것들 (기준선)
  console.log('-- 기존 검증된 API --');
  await probe('API214_1/RaceDetailResult_1', '/API214_1/RaceDetailResult_1', { meet: 1, rc_date: 20260517 });
  await probe('racedetailresult/getracedetailresult', '/racedetailresult/getracedetailresult', PREV_RACE);
  await probe('API18_1/dailyTraining_1', '/API18_1/dailyTraining_1', { meet: 1, tr_date: 20260520 });

  console.log('\n-- 기수 관련 후보들 --');
  await probe('jkinfo/getjkinfo', '/jkinfo/getjkinfo', { meet: 1 });
  await probe('jkyresult/getjkyresult', '/jkyresult/getjkyresult', { meet: 1 });
  await probe('jkresult/getJkResult', '/jkresult/getJkResult', { meet: 1 });
  await probe('API11_1/jockeyResult_1', '/API11_1/jockeyResult_1', { meet: 1 });
  await probe('API12_1/jockeyInfo_1', '/API12_1/jockeyInfo_1', { meet: 1 });
  await probe('jockeyinfo/getjockeyinfo', '/jockeyinfo/getjockeyinfo', { meet: 1 });
  await probe('jkResult/getJkResult', '/jkResult/getJkResult', { meet: 1 });

  console.log('\n-- 구간기록 후보들 --');
  await probe('API37_1/sectionRecord_1', '/API37_1/sectionRecord_1', PREV_RACE);
  await probe('API6_1/sectionRecord_6', '/API6_1/sectionRecord_6', PREV_RACE);

  // 출주표 (이전에 작동했던 경우 테스트용)
  console.log('\n-- 출주표 API (기준) --');
  await probe('API314/textDataHoldSePtinInfo', '/API314/textDataHoldSePtinInfo', { race_dt: 20260517, race_no: 1 });
}

main().catch(console.error);
