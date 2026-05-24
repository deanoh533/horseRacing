/**
 * 적중률 통계 (2년치 38,331행)
 *
 * - 단승 적중: 예측 1위 = 실제 1위
 * - 연승 적중: 예측 1위가 실제 1~2위 안
 * - 복승 적중: 예측 1위가 실제 1~3위 안
 * - 예측 TOP3 ↔ 실제 TOP3 교집합 비율
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

interface Row {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  predicted_rank: number;
  actual_ord: number | null;
}

async function fetchAll(sb: any): Promise<Row[]> {
  // 페이지네이션은 반드시 정렬 필요 (.range는 정렬 없으면 페이지 경계 중복 발생)
  const all: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, hr_name, predicted_rank, actual_ord')
      .order('race_date')
      .order('meet')
      .order('rc_no')
      .order('hr_name')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rows = await fetchAll(sb);
  console.log(`총 predictions 행: ${rows.length}`);

  // race 단위로 그룹
  const byRace = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }
  const totalRaces = byRace.size;

  let win = 0; // 예측 1위 = 실제 1위
  let place = 0; // 예측 1위 ∈ 실제 1~2위
  let show = 0; // 예측 1위 ∈ 실제 1~3위
  let validRaces = 0; // 실제 1~3위 데이터가 있는 경주만 카운트

  let top3Inter = 0; // 예측 TOP3 ∩ 실제 TOP3 평균 hits
  let top3RaceCount = 0;

  for (const horses of byRace.values()) {
    const pred1 = horses.find((h) => h.predicted_rank === 1);
    if (!pred1) continue;
    const actuals = horses.filter((h) => h.actual_ord !== null);
    if (actuals.length === 0) continue;
    validRaces++;

    if (pred1.actual_ord === 1) win++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 2) place++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 3) show++;

    // TOP3 교집합
    const predTop3 = new Set(horses.filter((h) => h.predicted_rank <= 3).map((h) => h.hr_name));
    const actTop3 = new Set(
      horses.filter((h) => h.actual_ord !== null && h.actual_ord <= 3).map((h) => h.hr_name)
    );
    if (actTop3.size > 0) {
      const inter = [...predTop3].filter((n) => actTop3.has(n)).length;
      top3Inter += inter;
      top3RaceCount++;
    }
  }

  const pct = (n: number, d: number) => ((n / d) * 100).toFixed(1);

  console.log(`\n적중률 (전체 ${totalRaces} 경주 / 유효 ${validRaces} 경주)\n`);
  console.log(`  단승  예측1위=실제1위         : ${win}/${validRaces} = ${pct(win, validRaces)}%`);
  console.log(`  연승  예측1위∈실제1~2위       : ${place}/${validRaces} = ${pct(place, validRaces)}%`);
  console.log(`  복승  예측1위∈실제1~3위       : ${show}/${validRaces} = ${pct(show, validRaces)}%`);
  console.log(
    `\n예측 TOP3 ↔ 실제 TOP3 교집합 평균: ${(top3Inter / top3RaceCount).toFixed(2)}마 (3마 중)`
  );
  console.log(
    `  → 평균 적중률: ${((top3Inter / top3RaceCount / 3) * 100).toFixed(1)}%`
  );

  // 무작위 기대값 비교 (평균 출전마 10마 가정)
  const avgHorses = rows.length / totalRaces;
  console.log(`\n참고: 평균 출전마 ${avgHorses.toFixed(1)}마, 랜덤 단승 기대 ${(100 / avgHorses).toFixed(1)}%`);
}
main();
