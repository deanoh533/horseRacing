import 'dotenv/config';
import axios from 'axios';

async function main() {
  const apiKey = process.env.KRA_API_KEY!;
  const { data } = await axios.get('https://apis.data.go.kr/B551015/horseinfohi/gethorseinfohi', {
    params: { serviceKey: apiKey, hrno: '0047073', pageNo: 1, numOfRows: 1, _type: 'json' },
  });
  const item = data?.response?.body?.items?.item;
  console.log(JSON.stringify(item, null, 2));
}
main();
