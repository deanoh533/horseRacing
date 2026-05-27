/**
 * 주행 성향 분류용 데이터 분포 조사 v2
 *
 * ChatGPT 인사이트 적용:
 *   - position_ratio = (s1f_ord - 1) / (field_size - 1)
 *   - 임계값: 0~0.15 도주 / 0.15~0.35 선행 / 0.35~0.65 선입 / 0.65~1 추입
 *   - early_ratio_std (자유마)
 *   - 거리별 스타일 변동
 *
 * 4가지 확인:
 *   ① position_ratio 분포 (5분류 비율)
 *   ② early_ratio_std 분포 (자유마 임계값)
 *   ③ 거리 카테고리별 같은 말의 ratio 변동 (거리별 분리 가치)
 *   ④ front_run_success_rate (선행 유지율)
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';

type EntryRow = {
  hr_name: string;
  race_date: number;
  meet: number;
  rc_no: number;
  s1f_ord: number;
  ord: number;
  rc_dist: number | null;
};

const avg = (arr: number[]) =>
  arr.length === 0 ? null : arr.reduce((s, v) => s + v, 0) / arr.length;
const stddev = (arr: number[]) => {
  if (arr.length < 2) return null;
  const m = avg(arr)!;
  return Math.sqrt(arr.map((v) => (v - m) ** 2).reduce((s, v) => s + v, 0) / (arr.length - 1));
};
const round = (v: number | null, d = 3) => (v == null ? '-' : v.toFixed(d));

function distBucket(d: number | null): string {
  if (d == null) return 'unknown';
  if (d < 1400) return 'short (<1400m)';
  if (d <= 1800) return 'middle (1400-1800m)';
  return 'long (>1800m)';
}

async function main() {
  const sb = getSupabaseAdmin();

  // ============================================
  // 1. race_entries fetch — 결과 있는 row만
  // ============================================
  console.log('📥 race_entries fetch...');
  const allRows: EntryRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('hr_name, race_date, meet, rc_no, sj_s1f_ord, bu_s1f_ord, ord, rc_dist')
      .not('ord', 'is', null)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      const s1f = r.meet === 1 ? r.sj_s1f_ord : r.bu_s1f_ord;
      if (s1f != null && s1f > 0 && r.ord != null) {
        allRows.push({
          hr_name: r.hr_name,
          race_date: r.race_date,
          meet: r.meet,
          rc_no: r.rc_no,
          s1f_ord: s1f,
          ord: r.ord,
          rc_dist: r.rc_dist,
        });
      }
    }
    if (data.length < PAGE) break;
  }
  console.log(`✅ ${allRows.length} rows\n`);

  // ============================================
  // 2. 경주별 field_size 계산 → position_ratio 부여
  // ============================================
  const raceKey = (r: EntryRow) => `${r.race_date}-${r.meet}-${r.rc_no}`;
  const fieldSize = new Map<string, number>();
  for (const r of allRows) {
    const k = raceKey(r);
    fieldSize.set(k, (fieldSize.get(k) ?? 0) + 1);
  }

  const withRatio = allRows
    .map((r) => {
      const fs = fieldSize.get(raceKey(r))!;
      if (fs < 2) return null;
      const ratio = (r.s1f_ord - 1) / (fs - 1);
      return { ...r, field_size: fs, position_ratio: ratio };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  console.log(`총 ${withRatio.length} rows (field_size ≥ 2)`);
  const fsArr = [...fieldSize.values()];
  console.log(`field_size: min=${Math.min(...fsArr)} max=${Math.max(...fsArr)} avg=${round(avg(fsArr))}\n`);

  // ============================================
  // ① position_ratio 분포
  // ============================================
  const ratios = withRatio.map((r) => r.position_ratio).sort((a, b) => a - b);
  const pct = (p: number) => ratios[Math.floor(ratios.length * p)];

  console.log('=== ① position_ratio 분포 (개별 경주 기준) ===');
  console.table([
    { stat: 'min', value: round(ratios[0] ?? null) },
    { stat: 'p10', value: round(pct(0.1) ?? null) },
    { stat: 'p25', value: round(pct(0.25) ?? null) },
    { stat: 'p50', value: round(pct(0.5) ?? null) },
    { stat: 'p75', value: round(pct(0.75) ?? null) },
    { stat: 'p90', value: round(pct(0.9) ?? null) },
    { stat: 'max', value: round(ratios[ratios.length - 1] ?? null) },
    { stat: 'mean', value: round(avg(ratios)) },
  ]);

  // ============================================
  // ChatGPT 임계값 적용 (개별 경주 단위)
  // ============================================
  const cgClassify = (r: number) => {
    if (r <= 0.15) return '1: 도주 (0-0.15)';
    if (r <= 0.35) return '2: 선행 (0.15-0.35)';
    if (r <= 0.65) return '3: 선입 (0.35-0.65)';
    return '4: 추입 (0.65-1.0)';
  };
  const indivBuckets = new Map<string, number>();
  for (const r of withRatio) {
    const k = cgClassify(r.position_ratio);
    indivBuckets.set(k, (indivBuckets.get(k) ?? 0) + 1);
  }
  console.log('\n=== ChatGPT 임계값 — 개별 경주 분포 ===');
  console.table(
    [...indivBuckets.entries()]
      .sort()
      .map(([k, v]) => ({
        bucket: k,
        rows: v,
        pct: ((v / withRatio.length) * 100).toFixed(1) + '%',
      }))
  );

  // ============================================
  // ② 마별 avg_ratio + STDDEV (3경주+)
  // ============================================
  const byHorse = new Map<string, number[]>();
  for (const r of withRatio) {
    if (!byHorse.has(r.hr_name)) byHorse.set(r.hr_name, []);
    byHorse.get(r.hr_name)!.push(r.position_ratio);
  }

  const horseStats: { hr_name: string; n: number; mean: number; std: number; cls: string }[] = [];
  for (const [name, arr] of byHorse) {
    if (arr.length < 3) continue;
    const m = avg(arr)!;
    const s = stddev(arr)!;
    horseStats.push({ hr_name: name, n: arr.length, mean: m, std: s, cls: cgClassify(m) });
  }

  console.log(`\n📊 3경주 이상 출전 말: ${horseStats.length}마`);

  // 마별 평균 ratio로 분류
  const horseBuckets = new Map<string, number>();
  for (const h of horseStats) {
    horseBuckets.set(h.cls, (horseBuckets.get(h.cls) ?? 0) + 1);
  }
  console.log('\n=== ② 마별 평균 ratio → 4분류 분포 (자유마 미적용) ===');
  console.table(
    [...horseBuckets.entries()]
      .sort()
      .map(([k, v]) => ({
        bucket: k,
        horses: v,
        pct: ((v / horseStats.length) * 100).toFixed(1) + '%',
      }))
  );

  // ============================================
  // ③ early_ratio_std 분포 (자유마)
  // ============================================
  const stds = horseStats.map((h) => h.std).sort((a, b) => a - b);
  const pctS = (p: number) => stds[Math.floor(stds.length * p)];

  console.log('\n=== ③ early_ratio_std 분포 (자유마 판정용) ===');
  console.table([
    { stat: 'min', value: round(stds[0] ?? null) },
    { stat: 'p25', value: round(pctS(0.25) ?? null) },
    { stat: 'p50', value: round(pctS(0.5) ?? null) },
    { stat: 'p75', value: round(pctS(0.75) ?? null) },
    { stat: 'p90', value: round(pctS(0.9) ?? null) },
    { stat: 'p95', value: round(pctS(0.95) ?? null) },
    { stat: 'max', value: round(stds[stds.length - 1] ?? null) },
    { stat: 'mean', value: round(avg(stds)) },
  ]);

  // 자유마 임계값 후보별 비율
  console.log('\n=== 자유마 임계값 후보별 비율 ===');
  console.table(
    [0.25, 0.3, 0.35, 0.4].map((thr) => ({
      threshold: thr,
      horses: stds.filter((s) => s >= thr).length,
      pct: ((stds.filter((s) => s >= thr).length / stds.length) * 100).toFixed(1) + '%',
    }))
  );

  // ============================================
  // ④ 거리별 같은 말의 ratio 변동 (거리별 분리 가치)
  // ============================================
  console.log('\n=== ④ 거리 카테고리별 ratio 분포 ===');
  const distRatios = new Map<string, number[]>();
  for (const r of withRatio) {
    const k = distBucket(r.rc_dist);
    if (!distRatios.has(k)) distRatios.set(k, []);
    distRatios.get(k)!.push(r.position_ratio);
  }
  console.table(
    [...distRatios.entries()]
      .sort()
      .map(([k, v]) => ({
        dist_bucket: k,
        rows: v.length,
        mean_ratio: round(avg(v)),
        stddev_ratio: round(stddev(v)),
      }))
  );

  // 같은 말의 거리별 ratio 변동 (단·중·장 다 뛴 말만)
  const horsePerDist = new Map<string, Map<string, number[]>>();
  for (const r of withRatio) {
    const db = distBucket(r.rc_dist);
    if (db === 'unknown') continue;
    if (!horsePerDist.has(r.hr_name)) horsePerDist.set(r.hr_name, new Map());
    const m = horsePerDist.get(r.hr_name)!;
    if (!m.has(db)) m.set(db, []);
    m.get(db)!.push(r.position_ratio);
  }

  // 단거리/중거리/장거리 모두에서 2경주 이상 뛴 말
  const versatileHorses: { hr_name: string; short: number; middle: number; long: number; diff: number }[] = [];
  for (const [name, distMap] of horsePerDist) {
    const s = distMap.get('short (<1400m)') ?? [];
    const m = distMap.get('middle (1400-1800m)') ?? [];
    const l = distMap.get('long (>1800m)') ?? [];
    if (s.length >= 2 && m.length >= 2 && l.length >= 2) {
      const sR = avg(s)!;
      const mR = avg(m)!;
      const lR = avg(l)!;
      const diff = Math.max(sR, mR, lR) - Math.min(sR, mR, lR);
      versatileHorses.push({ hr_name: name, short: sR, middle: mR, long: lR, diff });
    }
  }
  versatileHorses.sort((a, b) => b.diff - a.diff);

  console.log(`\n📊 단·중·장 거리 모두 2경주+ 뛴 말: ${versatileHorses.length}마`);
  console.log('\n=== 거리별 ratio 차이 큰 상위 10마 (거리별 분리 가치 검증) ===');
  console.table(
    versatileHorses.slice(0, 10).map((h) => ({
      hr_name: h.hr_name,
      short: h.short.toFixed(2),
      middle: h.middle.toFixed(2),
      long: h.long.toFixed(2),
      max_diff: h.diff.toFixed(2),
    }))
  );

  const diffStats = versatileHorses.map((h) => h.diff).sort((a, b) => a - b);
  console.log('\n=== 거리별 max - min ratio 차이 분포 ===');
  console.table([
    { stat: 'p25', value: round(diffStats[Math.floor(diffStats.length * 0.25)] ?? null) },
    { stat: 'p50', value: round(diffStats[Math.floor(diffStats.length * 0.5)] ?? null) },
    { stat: 'p75', value: round(diffStats[Math.floor(diffStats.length * 0.75)] ?? null) },
    { stat: 'p90', value: round(diffStats[Math.floor(diffStats.length * 0.9)] ?? null) },
  ]);

  // ============================================
  // ⑤ front_run_success_rate (선행 유지율)
  //   "출발 시 상위 30%(ratio ≤ 0.3)였을 때 결승 1-3등 비율"
  // ============================================
  console.log('\n=== ⑤ front_run_success_rate ===');
  let frontStart = 0;
  let frontStartAndFinish = 0;
  for (const r of withRatio) {
    const finishRatio = (r.ord - 1) / (r.field_size - 1);
    if (r.position_ratio <= 0.3) {
      frontStart++;
      if (finishRatio <= 0.3) frontStartAndFinish++; // 결승도 상위 30%
    }
  }
  console.log(
    `  출발 상위 30% rows: ${frontStart}, 그 중 결승도 상위 30% rows: ${frontStartAndFinish}`
  );
  console.log(
    `  전체 선행 유지율 = ${((frontStartAndFinish / frontStart) * 100).toFixed(1)}%`
  );

  // 추입 성공률
  let lateStart = 0;
  let lateSuccess = 0;
  for (const r of withRatio) {
    const finishRatio = (r.ord - 1) / (r.field_size - 1);
    if (r.position_ratio >= 0.65) {
      lateStart++;
      if (finishRatio <= 0.3) lateSuccess++;
    }
  }
  console.log(
    `  출발 하위 35%(추입형) rows: ${lateStart}, 결승 상위 30% 도달: ${lateSuccess}`
  );
  console.log(
    `  추입 성공률 = ${((lateSuccess / lateStart) * 100).toFixed(1)}%`
  );
}

main().catch((err) => {
  console.error('💥', err.message ?? err);
  process.exit(1);
});
