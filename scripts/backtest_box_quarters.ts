/**
 * 복승 3마리 박스 — 분기별 walk-forward 강건성 검증 (읽기전용).
 *
 * 각 holdout 분기를 "그 분기 시작 이전 전체 데이터"로 학습한 모델로 평가한다.
 * 분기마다 baseline vs baseline+<후보>를 같은 학습셋에서 비교 →
 * 후보의 한계 ROI 델타가 분기마다 +방향으로 일관되는지(강건성) 확인.
 *
 * baseline 정의·정산(settleBox)·로지스틱은 backtest_box.ts와 동일.
 * 차이: 단일 holdout 블록 → 분기 루프 + 후보를 baseline에서 격리.
 *
 * 사용:
 *   npm run backtest:box:quarters -- --candidate class_move --label top2 \
 *     --div data/quinella_dividends.jsonl
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { fitPL, predictPL, type PLRace } from '../src/engine/models/plackettLuce.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { pairKey } from '../src/engine/analysis/comboBacktest.js';
import { settleBox, type BoxHorse } from '../src/engine/analysis/boxBacktest.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row {
  race_date: number; meet: number; rc_no: number; hr_name: string;
  ord: number | null; top3: 0 | 1; top2?: 0 | 1; features: Feature[];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const load = (p: string): Row[] =>
  readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// backtest_box.ts와 동일 — 게이트 탈락/보류 후보는 baseline 제외(존재 시).
const NEW_CANDIDATES = [
  'early_pos_s1f_mean', 'early_pos_s1f_ratio_mean',
  'late_pos_g1f_mean', 'late_pos_g1f_ratio_mean',
  'late_200m_speed_mean', 'early_to_finish_gain_mean',
  'field_rating_mean', 'field_rating_max', 'rating_minus_field_mean',
  'body_weight', 'body_weight_minus_field_mean',
  'dist_change', 'track_change', 'away_meet',
];

// 평가 분기 (walk-forward: 학습 = 분기 시작 이전 전체). [start, end)
const QUARTERS: { name: string; start: number; end: number }[] = [
  { name: '2025 Q1', start: 20250101, end: 20250401 },
  { name: '2025 Q2', start: 20250401, end: 20250701 },
  { name: '2025 Q3', start: 20250701, end: 20251001 },
  { name: '2026 Q1', start: 20260101, end: 20260401 },
  { name: '2026 Q2', start: 20260401, end: 20260701 },
];

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const divPath = arg('--div', 'data/quinella_dividends.jsonl');
  const candidate = arg('--candidate', 'class_move');
  const labelArg = arg('--label', 'top2') as 'top2' | 'top3';
  // --model: logistic(기본) | pl | both — 분기별 두 모델 비교
  const modelArg = arg('--model', 'logistic');
  const models: ('logistic' | 'pl')[] = modelArg === 'both' ? ['logistic', 'pl']
    : modelArg === 'pl' ? ['pl'] : ['logistic'];

  const all = load(matrixPath);
  const minHold = Math.min(...QUARTERS.map((q) => q.start));
  const maxHold = Math.max(...QUARTERS.map((q) => q.end));
  console.log(`\n복승 박스 분기별 강건성 — 행렬 ${all.length}행, 후보=${candidate}, 라벨=${labelArg}`);

  // ── pthr 맵 (전 holdout 범위) ──
  const sb = getSupabaseAdmin();
  const pthrMap = new Map<string, number>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, pthr_no')
      .gte('race_date', minHold).lt('race_date', maxHold)
      .order('race_date').order('meet').order('rc_no').range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; hr_name: string; pthr_no: number }[]) {
      pthrMap.set(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`, r.pthr_no);
    }
    if (data.length < PAGE) break;
  }

  // ── 복승 배당 ──
  const comboByRace = new Map<string, Map<string, number>>();
  const divLines = load(divPath) as unknown as { race_date: number; meet: number; rc_no: number; a: number; b: number; odds: number }[];
  for (const d of divLines) {
    const rk = `${d.race_date}-${d.meet}-${d.rc_no}`;
    if (!comboByRace.has(rk)) comboByRace.set(rk, new Map());
    comboByRace.get(rk)!.set(pairKey(d.a, d.b), d.odds);
  }
  console.log(`  복승 배당 ${divLines.length}행 → ${comboByRace.size}경주\n`);

  // 스키마: 전체에서 한 번(피처 집합 일관). baseline은 _z·탈락후보·격리후보(candidate) 제외.
  const fullSchema = buildSchema(all.map((r) => r.features));
  if (!fullSchema.includes(candidate)) {
    console.log(`⚠️ 행렬에 후보 '${candidate}' 없음 — extract:matrix 재추출 필요. 중단.`);
    return;
  }
  const baseSchema = fullSchema.filter((n) => !n.endsWith('_z') && !NEW_CANDIDATES.includes(n) && n !== candidate);
  const candSchema = [...baseSchema, candidate];

  const evalVariant = (train: Row[], holdRaces: Map<string, Row[]>, schema: string[], label: 'top2' | 'top3', mdl: 'logistic' | 'pl') => {
    // 모델 학습 → 말별 점수 함수(scorer, 클수록 상위). PL은 라벨 무관·Brier 제외.
    let scorer: (r: Row) => number;
    let brierLabel: 'top2' | 'top3' | null;
    if (mdl === 'logistic') {
      const y = train.map((r) => (label === 'top2' ? (r.top2 ?? 0) : r.top3));
      const m = fitLogistic(train.map((r) => toVector(r.features, schema)), y as number[], schema, { l2: 0.02, iters: 800, lr: 0.2 });
      scorer = (r) => sigmoid(predictLogit(m, toVector(r.features, schema)));
      brierLabel = label;
    } else {
      const plByRace = new Map<string, PLRace['horses']>();
      for (const r of train) {
        if (r.ord == null) continue;
        const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
        if (!plByRace.has(k)) plByRace.set(k, []);
        plByRace.get(k)!.push({ x: toVector(r.features, schema), ord: r.ord });
      }
      const plRaces: PLRace[] = [...plByRace.values()].filter((hs) => hs.length >= 2).map((hs) => ({ horses: hs }));
      const m = fitPL(plRaces, schema, { l2: 0.02, iters: 800, lr: 0.2 });
      scorer = (r) => predictPL(m, toVector(r.features, schema));
      brierLabel = null;
    }
    let bettable = 0, hits = 0, roiProfit = 0, roiCost = 0, brierSum = 0, brierN = 0;
    for (const [rk, rows] of holdRaces) {
      const boxHorses: BoxHorse[] = [];
      for (const r of rows) {
        if (r.ord == null) continue;
        const pthr = pthrMap.get(`${rk}-${r.hr_name}`);
        if (pthr == null) continue;
        const p = scorer(r);
        boxHorses.push({ pthrNo: pthr, ord: r.ord, prob: p });
        if (brierLabel) {
          const yTrue = brierLabel === 'top2' ? (r.ord <= 2 ? 1 : 0) : (r.ord <= 3 ? 1 : 0);
          brierSum += (p - yTrue) ** 2; brierN++;
        }
      }
      const res = settleBox(boxHorses, comboByRace.get(rk) ?? new Map());
      if (!res) continue;
      bettable++;
      if (res.hit) hits++;
      if (res.profit != null) { roiProfit += res.profit; roiCost += 3; }
    }
    const roi = roiCost > 0 ? (roiProfit / roiCost) * 100 : NaN;
    return { bettable, hits, roi, brier: brierN ? brierSum / brierN : NaN };
  };

  const fmt = (v: { bettable: number; hits: number; roi: number; brier: number }) =>
    `${String(v.bettable).padStart(4)} | ${String(v.hits).padStart(4)} | ${(v.bettable ? (v.hits / v.bettable) * 100 : 0).toFixed(1).padStart(5)}% | ${(isNaN(v.roi) ? '-' : v.roi.toFixed(1) + '%').padStart(8)} | ${isNaN(v.brier) ? '-' : v.brier.toFixed(4)}`;

  console.log(`분기     | 모델     | 학습행  | 변형       | 베팅 | 적중 | 적중률 |   ROI%   | Brier`);
  console.log('-'.repeat(90));
  const deltasByModel = new Map<string, { q: string; delta: number }[]>();
  for (const q of QUARTERS) {
    const train = all.filter((r) => r.race_date < q.start);
    const hold = all.filter((r) => r.race_date >= q.start && r.race_date < q.end);
    if (hold.length === 0) { console.log(`${q.name} | (holdout 0행 — 행렬 범위 밖, 스킵)`); continue; }
    const byRace = new Map<string, Row[]>();
    for (const r of hold) {
      const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
      if (!byRace.has(k)) byRace.set(k, []);
      byRace.get(k)!.push(r);
    }
    for (const mdl of models) {
      const base = evalVariant(train, byRace, baseSchema, labelArg, mdl);
      const cand = evalVariant(train, byRace, candSchema, labelArg, mdl);
      console.log(`${q.name} | ${mdl.padEnd(8)} | ${String(train.length).padStart(6)} | baseline   | ${fmt(base)}`);
      console.log(`${q.name} | ${mdl.padEnd(8)} | ${String(train.length).padStart(6)} | +${candidate.padEnd(9)} | ${fmt(cand)}`);
      const delta = cand.roi - base.roi;
      if (!deltasByModel.has(mdl)) deltasByModel.set(mdl, []);
      deltasByModel.get(mdl)!.push({ q: q.name, delta });
      console.log(`${' '.repeat(9)}|${' '.repeat(9)} |${' '.repeat(8)} | Δ ROI      | ${(delta >= 0 ? '+' : '') + delta.toFixed(1)}%p`);
    }
    console.log('-'.repeat(90));
  }

  for (const [mdl, deltas] of deltasByModel) {
    console.log(`\n=== ${candidate} [${mdl}] 한계 ROI 델타 (분기별 일관성) ===`);
    for (const d of deltas) console.log(`  ${d.q}: ${(d.delta >= 0 ? '+' : '') + d.delta.toFixed(1)}%p`);
    const pos = deltas.filter((d) => d.delta > 0).length;
    const mean = deltas.reduce((s, d) => s + d.delta, 0) / (deltas.length || 1);
    console.log(`  → ${pos}/${deltas.length} 분기 +방향, 평균 ${(mean >= 0 ? '+' : '') + mean.toFixed(1)}%p`);
    console.log(pos === deltas.length ? '  ✅ 전 분기 일관 — 강건' : pos >= deltas.length - 1 ? '  ⚠️ 대체로 +, 1분기 약함' : '  ❌ 분기별 불일치 — 강건성 미확보');
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
