/**
 * 복승 3마리 박스 백테스트 — 경주 내 상대화(z-score) 효과 검증 (읽기전용).
 *
 * 4개 모델 변형을 같은 holdout(2025 Q1)에서 비교:
 *   {라벨 top3 / top2} × {피처 절대값만(abs) / 절대+z(absz)}
 * 지표: 복승 박스 적중률 / 박스 ROI(복승식 배당) / Brier(캘리브레이션 프록시).
 *
 * 학습: race_date < --split (기본 2024 전체). holdout: [--split, --holdout-end).
 *
 * 사용:
 *   npm run backtest:box -- --matrix data/training_matrix.jsonl \
 *     --split 20250101 --holdout-end 20250401 --div data/quinella_dividends.jsonl
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
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

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));
  const holdoutEnd = Number(arg('--holdout-end', '20250401'));
  const divPath = arg('--div', '');

  const all = load(matrixPath);
  const train = all.filter((r) => r.race_date < split);
  const holdout = all.filter((r) => r.race_date >= split && r.race_date < holdoutEnd);
  console.log(`\n복승 박스 백테스트 — 행렬 ${all.length}행`);
  console.log(`  학습 ${train.length}행(<${split}) / holdout ${holdout.length}행([${split},${holdoutEnd}))`);

  // top2 라벨 존재 확인 (구 행렬 호환)
  const hasTop2 = train.some((r) => r.top2 != null);
  if (!hasTop2) console.log('  ⚠️ 행렬에 top2 라벨 없음 → top2 모델 생략 (extract:matrix 재실행 필요)');

  // ── pthr_no 맵 (holdout 범위) — 복승 배당 매칭·박스 정산용 ──
  const sb = getSupabaseAdmin();
  const pthrMap = new Map<string, number>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, pthr_no')
      .gte('race_date', split).lt('race_date', holdoutEnd)
      .order('race_date').order('meet').order('rc_no').range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; hr_name: string; pthr_no: number }[]) {
      pthrMap.set(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`, r.pthr_no);
    }
    if (data.length < PAGE) break;
  }

  // ── 복승식 배당 (선택) ──
  const comboByRace = new Map<string, Map<string, number>>();
  if (divPath) {
    const divLines = load(divPath) as unknown as { race_date: number; meet: number; rc_no: number; a: number; b: number; odds: number }[];
    for (const d of divLines) {
      const rk = `${d.race_date}-${d.meet}-${d.rc_no}`;
      if (!comboByRace.has(rk)) comboByRace.set(rk, new Map());
      comboByRace.get(rk)!.set(pairKey(d.a, d.b), d.odds);
    }
    console.log(`  복승 배당 ${divLines.length}행 → ${comboByRace.size}경주`);
  } else {
    console.log('  복승 배당 파일 없음(--div) → ROI 생략, 적중률·Brier만');
  }

  // holdout 경주 그룹
  const byRace = new Map<string, Row[]>();
  for (const r of holdout) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }

  // 게이트A에서 탈락했거나 검증 중인 신규 후보 — baseline에서 제외(존재 시)
  const NEW_CANDIDATES = [
    // 구간 후보 (게이트A·B 탈락 종결)
    'early_pos_s1f_mean', 'early_pos_s1f_ratio_mean',
    'late_pos_g1f_mean', 'late_pos_g1f_ratio_mean',
    'late_200m_speed_mean', 'early_to_finish_gain_mean',
    // 게이트 탈락(코드 잔존 시) — baseline 제외
    'field_rating_mean', 'field_rating_max', 'rating_minus_field_mean',
    // 마체중: 게이트B 통과했으나 라이브 누수로 보류 → baseline 제외 유지
    'body_weight', 'body_weight_minus_field_mean',
    // 직전대비 변화 후보(2026-06-10, 게이트 검증 중) → 통과 전까지 baseline 제외
    'dist_change', 'track_change', 'away_meet',
    // class_move는 채택 → baseline 포함(여기 넣지 않음).
  ];
  // --candidate: 콤마로 여러 개 → 함께 baseline에 추가 (그룹 단위 켜고 끄기)
  const candidate = arg('--candidate', '');
  const candList = candidate.split(',').map((s) => s.trim()).filter(Boolean);
  const labelArg = arg('--label', '');
  const labels: ('top3' | 'top2')[] = labelArg === 'top2' ? ['top2']
    : labelArg === 'top3' ? ['top3']
    : hasTop2 ? ['top3', 'top2'] : ['top3'];

  const fullSchema = buildSchema(train.map((r) => r.features));
  // baseline = 기존 60개 (z·신규후보 전부 제외)
  const baseSchema = fullSchema.filter((n) => !n.endsWith('_z') && !NEW_CANDIDATES.includes(n));

  // 변형 정의: --candidate 주면 baseline vs baseline+후보들 (단독/그룹 효과 격리),
  // 없으면 abs(z제외) vs absz(전체)
  let variants: { name: string; schema: string[] }[];
  if (candList.length > 0) {
    const missing = candList.filter((c) => !fullSchema.includes(c));
    if (missing.length) console.log(`⚠️ 행렬에 없음: ${missing.join(', ')} (extract:matrix 확인)`);
    const present = candList.filter((c) => fullSchema.includes(c));
    variants = [
      { name: 'baseline', schema: baseSchema },
      { name: `+${candList.join('+')}`, schema: [...baseSchema, ...present] },
    ];
  } else {
    variants = [
      { name: 'abs', schema: fullSchema.filter((n) => !n.endsWith('_z')) },
      { name: 'absz', schema: fullSchema },
    ];
  }
  const w = Math.max(8, ...variants.map((v) => v.name.length));

  console.log(`\n${'변형'.padEnd(w)} | 라벨  | 베팅수 | 박스적중 | 적중률 |   ROI%   | Brier`);
  console.log('-'.repeat(62 + w));

  for (const v of variants) {
    const schema = v.schema;

    for (const label of labels) {
      const y = train.map((r) => (label === 'top2' ? (r.top2 ?? 0) : r.top3));
      const model = fitLogistic(train.map((r) => toVector(r.features, schema)), y as number[], schema, { l2: 0.02, iters: 800, lr: 0.2 });

      let bettable = 0, hits = 0;
      let roiProfit = 0, roiCost = 0;
      let brierSum = 0, brierN = 0;

      for (const [rk, rows] of byRace) {
        const boxHorses: BoxHorse[] = [];
        for (const r of rows) {
          if (r.ord == null) continue;
          const pthr = pthrMap.get(`${rk}-${r.hr_name}`);
          if (pthr == null) continue;
          const p = sigmoid(predictLogit(model, toVector(r.features, schema)));
          boxHorses.push({ pthrNo: pthr, ord: r.ord, prob: p });
          // Brier (선택 라벨 기준)
          const yTrue = label === 'top2' ? (r.ord <= 2 ? 1 : 0) : (r.ord <= 3 ? 1 : 0);
          brierSum += (p - yTrue) ** 2; brierN++;
        }
        const res = settleBox(boxHorses, comboByRace.get(rk) ?? new Map());
        if (!res) continue;
        bettable++;
        if (res.hit) hits++;
        if (res.profit != null) { roiProfit += res.profit; roiCost += 3; }
      }

      const hitRate = bettable ? ((hits / bettable) * 100).toFixed(1) : '-';
      const roi = roiCost > 0 ? ((roiProfit / roiCost) * 100).toFixed(1) + '%' : '-';
      const brier = brierN ? (brierSum / brierN).toFixed(4) : '-';
      console.log(
        `${v.name.padEnd(w)} | ${label.padEnd(5)} | ${String(bettable).padStart(6)} | ${String(hits).padStart(8)} | ${hitRate.padStart(5)}% | ${roi.padStart(8)} | ${brier}`
      );
    }
  }
  console.log('-'.repeat(62 + w));
  console.log(candList.length > 0
    ? `판정 = 박스 ROI. baseline vs +${candList.join('+')} 차이로 효과 확인 (top2 기준).`
    : '판정 = 박스 ROI (적중률·Brier 참고). abs vs absz 비교로 상대화 효과 확인.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
