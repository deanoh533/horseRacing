/**
 * 출주표 API가 어디까지 미래 데이터 주는지 탐색
 */
import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.KRA_API_KEY!;

async function test(rcDate: number, rcNo: number) {
  const { data } = await axios.get(
    'https://apis.data.go.kr/B551015/API314/textDataHoldSePtinInfo',
    {
      params: { serviceKey: apiKey, race_dt: rcDate, race_no: rcNo, pageNo: 1, numOfRows: 1, _type: 'json' },
      timeout: 10000,
    }
  );
  const items = data?.response?.body?.items?.item;
  const total = data?.response?.body?.totalCount ?? 0;
  return total;
}

async function main() {
  // 토/일 데이터 시도
  const dates = [
    20260524, // 오늘 (일)
    20260525, // 내일 (월) — 경마 없음
    20260530, // 다음 토
    20260531, // 다음 일
    20260606, // 그 다음 토
    20260607, // 그 다음 일
  ];
  for (const d of dates) {
    try {
      const cnt = await test(d, 1);
      console.log(`  ${d} 1R: totalCount=${cnt}`);
    } catch (e) {
      console.log(`  ${d} 1R: ERR ${(e as Error).message.slice(0, 60)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
main();
