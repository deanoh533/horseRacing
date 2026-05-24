/**
 * KRA 출주표 API 탐색
 * 공공데이터 포털 KRA가 제공하는 endpoint 후보들 시도
 *
 * 패턴:
 *   API12_1: 경주마 기본정보
 *   API4_*: 결과 관련
 *   API114: 경마성적
 *   API8_2: 출주표 가능성?
 *   raceScheduleInfo: 경주 일정
 *   raceCard: 출주표
 */
import 'dotenv/config';
import axios from 'axios';

const BASE = 'https://apis.data.go.kr/B551015';
const apiKey = process.env.KRA_API_KEY!;

const CANDIDATES = [
  // 우리가 이미 쓰는 것 (확인용)
  ['/racedetailresult/getracedetailresult', 'race detail (이미 사용)'],
  // 출주표 후보
  ['/API8_2/raceScheduleInfo_2', 'API8_2 race schedule'],
  ['/API8_2/raceCardInfo', 'API8_2 race card'],
  ['/raceScheduleInfo/getRaceScheduleInfo', 'race schedule'],
  ['/raceCardInfo/getRaceCardInfo', 'race card info'],
  ['/raceCard/getRaceCard', 'race card'],
  ['/API12_1/raceCard', 'API12_1 race card'],
  ['/API4_1/raceCard', 'API4_1 race card'],
  // KRA 추가 후보
  ['/API114_1/raceCard', 'API114 race card'],
  ['/raceParticipants/getRaceParticipants', 'race participants'],
];

async function tryEndpoint(path: string, label: string) {
  const url = `${BASE}${path}`;
  try {
    const { data, status } = await axios.get(url, {
      params: {
        serviceKey: apiKey,
        meet: 1,
        rc_date: 20260530, // 미래 날짜 (출주표는 경기 전에 발표)
        rc_no: 1,
        pageNo: 1,
        numOfRows: 3,
        _type: 'json',
      },
      timeout: 10000,
      validateStatus: () => true,
    });
    const resultCode = data?.response?.header?.resultCode ?? data?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode ?? '?';
    const items = data?.response?.body?.items?.item;
    const has = items ? (Array.isArray(items) ? items.length : 1) : 0;
    console.log(`  [${status}] code=${resultCode} items=${has}  ${label}`);
    if (has > 0) {
      const sample = Array.isArray(items) ? items[0] : items;
      console.log(`    필드: ${Object.keys(sample).join(', ')}`);
    }
  } catch (e) {
    console.log(`  [ERR] ${label}: ${(e as Error).message.slice(0, 60)}`);
  }
}

async function main() {
  console.log('KRA 출주표 API 후보 탐색\n');
  for (const [path, label] of CANDIDATES) {
    await tryEndpoint(path, label);
    await new Promise((r) => setTimeout(r, 500)); // rate limit 방지
  }
}
main();
