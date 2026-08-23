/**
 * 복승 박스 두수 스윕 백테스트 — walk-forward (읽기전용).
 *
 * 질문: "예측 상위 N두를 복승 박스로 사면 N이 몇일 때 가장 나은가?"
 * 45경주 라이브 표본으로는 판정 불가 → 과거 대표본 + 시점 정직 학습으로 판정한다.
 *
 * 정직성:
 *   - 분기마다 그 분기 시작일 **이전** 데이터로만 로지스틱을 새로 학습(walk-forward).
 *     한 번 학습해 전 구간에 쓰면 미래 정보가 새므로 분기별 재학습이 핵심.
 *   - 배당은 사후 확정배당 → 내 베팅의 배당 희석 효과 미반영(ROI 낙관적 상한).
 *   - 5두 미만 경주는 복승 미발매 가정으로 제외(settleBoxN).
 *
 * 데이터: 전부 로컬(행렬 jsonl + 배당 jsonl + DuckDB 미러) — Supabase egress 0.
 *   미러가 오래됐으면 `npm run db:pull -- --table race_entries` 선행.
 *
 * 사용:
 *   npx tsx scripts/backtest_box_size.ts \
 *     --matrix data/training_matrix_2022.jsonl \
 *     --div data/quinella_dividends.jsonl \
 *     --from 20250101 --to 20260510
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { pairKey } from '../src/engine/analysis/comboBacktest.js';
import { settleBoxN, type BoxHorse } from '../src/engine/analysis/boxBacktest.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row {
  race_date: number; meet: number; rc_no: number; hr_name: string;
  ord: number | null; win_odds: number | null; top3: 0 | 1; top2?: 0 | 1;
  features: Feature[];
}
interface DivLine { race_date: number; meet: number; rc_no: number; a: number; b: number; odds: number }

/** baseline에서 뺄 피처 — backtest_box.ts의 NEW_CANDIDATES와 같은 목록(게이트 탈락·라이브 누수). */
const EXCLUDED = new Set([
  'early_pos_s1f_mean', 'early_pos_s1f_ratio_mean',
  'late_pos_g1f_mean', 'late_pos_g1f_ratio_mean',
  'late_200m_speed_mean', 'early_to_finish_gain_mean',
  'field_rating_mean', 'field_rating_max', 'rating_minus_field_mean',
  'body_weight', 'body_weight_minus_field_mean',
  'dist_change', 'track_change', 'away_meet',
]);

const BOX_SIZES = [2, 3, 4, 5, 6];
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const rk = (r: { race_date: number; meet: number; rc_no: number }) => `${r.race_date}-${r.meet}-${r.rc_no}`;

/** YYYYMMDD → 그 날짜가 속한 분기의 시작일(YYYYMMDD). */
function quarterStart(d: number): number {
  const y = Math.floor(d / 10000);
  const m = Math.floor((d % 10000) / 100);
  return y * 10000 + (Math.floor((m - 1) / 3) * 3 + 1) * 100 + 1;
}
function nextQuarter(qs: number): number {
  const y = Math.floor(qs / 10000);
  const m = Math.floor((qs % 10000) / 100);
  return m === 10 ? (y + 1) * 10000 + 101 : y * 10000 + (m + 3) * 100 + 1;
}
const qLabel = (qs: number) => `${Math.floor(qs / 10000)}Q${Math.floor((Math.floor((qs % 10000) / 100) - 1) / 3) + 1}`;

function loadJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

/** 누적 집계 한 칸. profit/cost는 "조합 1건 = 1단위" 기준. */
interface Acc { races: number; hits: number; profit: number; cost: number; priced: number }
const newAcc = (): Acc => ({ races: 0, hits: 0, profit: 0, cost: 0, priced: 0 });

function fmt(a: Acc): string {
  const hit = a.races ? (a.hits / a.races) * 100 : 0;
  const roi = a.cost ? (a.profit / a.cost) * 100 : NaN;
  return `${String(a.races).padStart(6)} | ${String(a.hits).padStart(5)} | ${hit.toFixed(1).padStart(5)}% | `
    + `${(Number.isNaN(roi) ? '-' : (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%').padStart(8)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix_2022.jsonl');
  const divPath = arg('--div', 'data/quinella_dividends.jsonl');
  const from = Number(arg('--from', '20250101'));
  const to = Number(arg('--to', '20260510'));

  console.log('\n=== 복승 박스 두수 스윕 (walk-forward) ===');
  const all = loadJsonl<Row>(matrixPath);
  console.log(`행렬 ${matrixPath}: ${all.length.toLocaleString()}행 (${all[0]!.race_date}~${all[all.length - 1]!.race_date})`);

  const divLines = loadJsonl<DivLine>(divPath);
  const comboByRace = new Map<string, Map<string, number>>();
  for (const d of divLines) {
    const k = rk(d);
    if (!comboByRace.has(k)) comboByRace.set(k, new Map());
    comboByRace.get(k)!.set(pairKey(d.a, d.b), d.odds);
  }
  console.log(`배당 ${divPath}: ${divLines.length.toLocaleString()}행 → ${comboByRace.size.toLocaleString()}경주`);

  // 마번(pthr_no) 맵 — DuckDB 로컬 미러 (egress 0)
  const sb = await getReadClient();
  const pthrMap = new Map<string, number>();
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, pthr_no')
      .gte('race_date', from).lt('race_date', to)
      .order('race_date').order('meet').order('rc_no').range(off, off + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { race_date: number; meet: number; rc_no: number; hr_name: string; pthr_no: number }[];
    for (const r of rows) pthrMap.set(`${rk(r)}-${r.hr_name}`, r.pthr_no);
    if (rows.length < PAGE) break;
  }
  console.log(`마번 맵: ${pthrMap.size.toLocaleString()}행 (DuckDB 미러)\n`);

  const schema = buildSchema(all.map((r) => r.features)).filter((n) => !n.endsWith('_z') && !EXCLUDED.has(n));
  console.log(`피처 ${schema.length}개 · 라벨 top2 · 박스 두수 ${BOX_SIZES.join('/')}\n`);

  const total: Record<number, Acc> = Object.fromEntries(BOX_SIZES.map((n) => [n, newAcc()]));
  const perQuarter: { label: string; accs: Record<number, Acc> }[] = [];

  for (let qs = quarterStart(from); qs < to; qs = nextQuarter(qs)) {
    const qe = Math.min(nextQuarter(qs), to);
    const train = all.filter((r) => r.race_date < qs && r.ord != null);
    const test = all.filter((r) => r.race_date >= qs && r.race_date < qe);
    if (train.length === 0 || test.length === 0) continue;

    // 시점 정직: 이 분기 시작 전 데이터로만 학습
    const model = fitLogistic(
      train.map((r) => toVector(r.features, schema)),
      train.map((r) => r.top2 ?? (r.ord != null && r.ord <= 2 ? 1 : 0)),
      schema, { l2: 0.02, iters: 800, lr: 0.2 },
    );

    const byRace = new Map<string, Row[]>();
    for (const r of test) {
      const k = rk(r);
      if (!byRace.has(k)) byRace.set(k, []);
      byRace.get(k)!.push(r);
    }

    const accs: Record<number, Acc> = Object.fromEntries(BOX_SIZES.map((n) => [n, newAcc()]));
    for (const [k, rows] of byRace) {
      const odds = comboByRace.get(k);
      if (!odds || odds.size === 0) continue; // 배당 없는 경주는 ROI 판정 불가 → 제외
      const horses: BoxHorse[] = [];
      for (const r of rows) {
        if (r.ord == null) continue;
        const pthr = pthrMap.get(`${k}-${r.hr_name}`);
        if (pthr == null) continue;
        horses.push({ pthrNo: pthr, ord: r.ord, prob: sigmoid(predictLogit(model, toVector(r.features, schema))) });
      }
      for (const n of BOX_SIZES) {
        const res = settleBoxN(horses, odds, n);
        if (!res) continue;
        const a = accs[n]!;
        a.races++;
        if (res.hit) a.hits++;
        if (res.profit != null) { a.profit += res.profit; a.cost += (Math.min(n, horses.length) * (Math.min(n, horses.length) - 1)) / 2; a.priced++; }
      }
    }

    for (const n of BOX_SIZES) {
      const a = accs[n]!, t = total[n]!;
      t.races += a.races; t.hits += a.hits; t.profit += a.profit; t.cost += a.cost; t.priced += a.priced;
    }
    perQuarter.push({ label: qLabel(qs), accs });
    console.log(`  ${qLabel(qs)}: 학습 ${train.length.toLocaleString()}행 → 판정 ${accs[BOX_SIZES[0]!]!.races}경주`);
  }

  console.log(`\n두수 | 경주수 | 적중  | 적중률 |   ROI`);
  console.log('-'.repeat(46));
  for (const n of BOX_SIZES) console.log(`상위${n} | ${fmt(total[n]!)}`);
  console.log('-'.repeat(46));

  console.log(`\n분기별 ROI (판정 = 모든 분기에서 일관된 부호인가)`);
  const head = perQuarter.map((q) => q.label.padStart(8)).join(' |');
  console.log(`두수  |${head}`);
  for (const n of BOX_SIZES) {
    const cells = perQuarter.map((q) => {
      const a = q.accs[n]!;
      const roi = a.cost ? (a.profit / a.cost) * 100 : NaN;
      return (Number.isNaN(roi) ? '-' : (roi >= 0 ? '+' : '') + roi.toFixed(0) + '%').padStart(8);
    }).join(' |');
    console.log(`상위${n} |${cells}`);
  }

  console.log(`\n환급률 기준선: 복승 약 -20%. 이보다 나쁘면 "아무 조합이나 사는 것보다 못함".`);
  console.log(`배당은 사후 확정 → 실제 베팅 시 배당 희석으로 더 낮아짐(낙관적 상한).`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
