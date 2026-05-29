import 'dotenv/config';
import axios from 'axios';

const { data } = await axios.get('https://apis.data.go.kr/B551015/API214_1/RaceDetailResult_1', {
  params: { serviceKey: process.env.KRA_API_KEY, meet: 1, rc_date: 20260523, pageNo: 1, numOfRows: 1, _type: 'json' },
  timeout: 15000,
});
const item = data.response.body.items.item;
const r = Array.isArray(item) ? item[0] : item;

console.log('buG1fOrd    :', r.buG1fOrd);
console.log('se_1cAccTime:', r.se_1cAccTime);
console.log('sj_1cOrd    :', r.sj_1cOrd);
console.log('wgHr        :', r.wgHr);
console.log('winOdds     :', r.winOdds);
console.log('track       :', r.track);
console.log('weather     :', r.weather);
