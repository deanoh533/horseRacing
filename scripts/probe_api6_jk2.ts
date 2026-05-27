/**
 * API6_1/jkpresult 추가 URL 탐색 (2차)
 * npx tsx scripts/probe_api6_jk2.ts
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;
const BASE = 'https://apis.data.go.kr/B551015';

async function probe(label: string, url: string, params: Record<string, string | number>) {
  try {
    const { data } = await axios.get(url, {
      params: { serviceKey: apiKey, pageNo: 1, numOfRows: 2, _type: 'json', ...params },
      timeout: 15000,
    });
    const code = data?.response?.header?.resultCode;
    const count = data?.response?.body?.totalCount;
    const items = data?.response?.body?.items?.item;
    if (code === '00') {
      console.log(`[OK] ${label} | count=${count}`);
      if (items) {
        const arr = Array.isArray(items) ? items : [items];
        console.log('  FIELDS: ' + Object.keys(arr[0]).join(', '));
        console.log('  SAMPLE: ' + JSON.stringify(arr[0]).slice(0, 300));
      }
      return true;
    } else {
      console.log(`[FAIL code=${code}] ${label}`);
    }
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } }).response?.status;
    const msg = (e as Error).message;
    console.log(`[${status ?? 'ERR'}] ${label} — ${msg.slice(0, 50)}`);
  }
  return false;
}

async function main() {
  // API6_1: 경주 후 구간기록 - 다양한 경주날짜/경주번호로 기존 데이터 시도
  console.log('=== API6_1 구간기록 (기존 레이스 날짜 사용) ===');
  const api6Paths = [
    '/API6_1/raceResult_6',    // 기존 probe 실패
    '/API6_1/sectRecord_6',
    '/API6_1/buRecord_6',
    '/API6_1/furRecord_6',
    '/API6_1/sectionRaceResult_6',
  ];
  // 과거 날짜 (결과 있는 경주) 로 시도
  const params6 = { meet: 1, rc_date: 20260510, rc_no: 1 };
  for (const path of api6Paths) {
    await probe(path, BASE + path, params6);
  }

  // jkpresult: 기수 성적 - 기수번호 포함 시도
  console.log('\n=== jkpresult 기수성적 (기수번호 포함) ===');
  const jkPaths = [
    '/jkpresult/jockeyResult',
    '/jkpresult/getjockeyresult',
    '/jkresult/getJkResult',
    '/jkresult/jkResult',
    '/jkresult/jockeyResult',
    '/jkResultInfo/getJkResultInfo',
    '/jockeyResult/getJockeyResult',
  ];
  for (const path of jkPaths) {
    await probe(path, BASE + path, { jk_no: '051174', meet: 1 });
  }

  // API37_1 구간기록 (403이었는데 기수번호 대신 경주 파라미터로 재시도)
  console.log('\n=== API37_1 (403이었음 — 구독 문제인지 확인) ===');
  await probe('/API37_1/sectionRecord_1', BASE + '/API37_1/sectionRecord_1', {
    meet: 1, rc_date: 20260510, rc_no: 1,
  });

  // 추가 조합 시도
  console.log('\n=== 추가 경로 조합 ===');
  const morePaths = [
    '/raceResult/getSectionRecord',
    '/raceResult/getRaceSectionRecord',
    '/sectionRecord/getSectionRecord',
    '/API214_1/SectionRecord_214',
    '/API214_1/sectionRecordResult_214',
  ];
  for (const path of morePaths) {
    await probe(path, BASE + path, { meet: 1, rc_date: 20260510, rc_no: 1 });
  }
}

main().catch(console.error);
