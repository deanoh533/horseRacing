/**
 * KRA racedetailresult 응답의 raw 필드 전체 출력
 * stOrd 진위 여부 확인
 */
import 'dotenv/config';
import axios from 'axios';

async function main() {
  const apiKey = process.env.KRA_API_KEY!;
  const url = 'https://apis.data.go.kr/B551015/API1_2/raceDetailResult_2';
  // 우리가 호출하는 엔드포인트
  const altUrl = 'https://apis.data.go.kr/B551015/racedetailresult/getracedetailresult';

  console.log('=== /racedetailresult/getracedetailresult ===');
  try {
    const { data } = await axios.get(altUrl, {
      params: {
        serviceKey: apiKey,
        meet: 1,
        rc_date: 20260523,
        rc_no: 1,
        pageNo: 1,
        numOfRows: 5,
        _type: 'json',
      },
    });
    const items = data?.response?.body?.items?.item ?? [];
    const arr = Array.isArray(items) ? items : [items];
    if (arr.length > 0) {
      console.log('필드 키 목록:', Object.keys(arr[0]).join(', '));
      console.log('\n샘플 row 1:');
      console.log(JSON.stringify(arr[0], null, 2));
    } else {
      console.log('응답 비어있음');
      console.log(JSON.stringify(data, null, 2).slice(0, 2000));
    }
  } catch (e) {
    console.error('실패:', (e as Error).message);
  }
}
main();
