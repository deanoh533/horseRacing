/**
 * 오프라인 로지스틱 실험 — 훈련 행렬 JSONL 기반
 *
 * 시간 분할 (train < --split, test >= --split) 후
 * 로지스틱 모델을 학습하고 테스트셋에서 지표를 측정한다.
 *
 * 지표: 연승(3착내)·단승(1착)·묶음(상위3 교집합)·ROI(단승 배당)
 * 비교: MODEL vs MARKET(win_odds 최저) vs v1(predictions.predicted_rank=1)
 *
 * 사용:
 *   npm run exp:logistic
 *   npm run exp:logistic -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as readline from 'readline';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

// ─── 타입 ───────────────────────────────────────────────────────────────────

interface MatrixRow {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  ord: number | null;
  win_odds: number | null;
  top3: 0 | 1;
  features: Feature[];
}

// ─── 유틸 (walkforward_eval.ts 패턴 복사) ──────────────────────────────────

function quarterOf(raceDate: number): { year: number; q: number } {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return { year: y, q: Math.floor((m - 1) / 3) + 1 };
}
const qKey = (y: number, q: number) => `${y}-Q${q}`;

interface Tally { win: number; place: number; show: number; n: number; }
const emptyTally = (): Tally => ({ win: 0, place: 0, show: 0, n: 0 });

function addRace(t: Tally, ord: number | null | undefined): void {
  if (ord == null || ord > 50) return;
  t.n++;
  if (ord === 1) t.win++;
  if (ord <= 2) t.place++;
  if (ord <= 3) t.show++;
}

const pct = (a: number, n: number): string =>
  n ? ((a / n) * 100).toFixed(1) : '-';

const isShow = (ord: number | null | undefined): boolean =>
  ord != null && ord >= 1 && ord <= 3;

// ─── JSONL 로더 ─────────────────────────────────────────────────────────────

async function loadMatrix(matrixPath: string): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];
  const fileStream = fs.createReadStream(matrixPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as MatrixRow);
  }
  return rows;
}

// ─── v1 베이스라인 — predictions 테이블에서 레이스별 1순위 픽 ──────────────

interface V1Pick {
  hr_name: string;
  actual_ord: number | null;
}

async function fetchV1Picks(
  sb: SupabaseClient,
  raceDates: Set<number>
): Promise<Map<string, V1Pick>> {
  // 테스트 기간의 min/max race_date 범위로 범위 좁힌 후 predicted_rank=1만 필터
  const minDate = Math.min(...raceDates);
  const maxDate = Math.max(...raceDates);
  const map = new Map<string, V1Pick>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, hr_name, predicted_rank, actual_ord')
      .gte('race_date', minDate)
      .lte('race_date', maxDate)
      .eq('predicted_rank', 1)
      .order('race_date')
      .order('meet')
      .order('rc_no')
      .order('hr_name')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as {
      race_date: number;
      meet: number;
      rc_no: number;
      hr_name: string;
      predicted_rank: number;
      actual_ord: number | null;
    }[]) {
      const rk = `${r.race_date}-${r.meet}-${r.rc_no}`;
      map.set(rk, { hr_name: r.hr_name, actual_ord: r.actual_ord });
    }
    if (data.length < PAGE) break;
  }
  return map;
}

// ─── 메인 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const matrixIdx = args.indexOf('--matrix');
  const matrixPath = matrixIdx >= 0 ? args[matrixIdx + 1]! : 'data/training_matrix.jsonl';

  const splitIdx = args.indexOf('--split');
  const splitDate = splitIdx >= 0 ? Number(args[splitIdx + 1]) : 20250101;

  console.log(`\n로지스틱 실험 — 행렬: ${matrixPath}  |  분할: ${splitDate}`);
  console.log('='.repeat(80));

  // ── 1. JSONL 로드 + 분할 ──────────────────────────────────────────────────
  if (!fs.existsSync(matrixPath)) {
    console.error(`행렬 파일 없음: ${matrixPath}`);
    process.exit(1);
  }
  const allRows = await loadMatrix(matrixPath);
  const trainRows = allRows.filter((r) => r.race_date < splitDate);
  const testRows = allRows.filter((r) => r.race_date >= splitDate);
  console.log(`총 ${allRows.length}행  →  학습 ${trainRows.length}행 / 테스트 ${testRows.length}행`);

  if (trainRows.length === 0) throw new Error('학습 행 없음. --split 값 확인');
  if (testRows.length === 0) throw new Error('테스트 행 없음. --split 값 확인');

  // ── 2. 스키마 + 행렬 구성 (학습) ─────────────────────────────────────────
  const schema = buildSchema(trainRows.map((r) => r.features));
  const Xtr = trainRows.map((r) => toVector(r.features, schema));
  const ytr = trainRows.map((r) => r.top3);

  console.log(`피처 수: ${schema.length}`);

  // ── 3. 로지스틱 학습 ──────────────────────────────────────────────────────
  const model = fitLogistic(Xtr, ytr as number[], schema, {
    l2: 0.02,
    iters: 800,
    lr: 0.2,
  });

  // ── 4. v1 베이스라인 로드 ─────────────────────────────────────────────────
  const sb = getSupabaseAdmin();
  const testDates = new Set(testRows.map((r) => r.race_date));
  console.log(`v1 베이스라인 로드 중 (predictions)...`);
  const v1Picks = await fetchV1Picks(sb, testDates);
  console.log(`v1 피크 ${v1Picks.size}개 경주`);

  // ── 5. 테스트 행 그룹화: 분기 → 경주 ──────────────────────────────────────
  type RaceKey = string; // `${race_date}-${meet}-${rc_no}`
  type QKey = string;   // `${year}-Q${q}`
  const byQuarter = new Map<QKey, Map<RaceKey, MatrixRow[]>>();

  for (const r of testRows) {
    const { year, q } = quarterOf(r.race_date);
    const qk = qKey(year, q);
    if (!byQuarter.has(qk)) byQuarter.set(qk, new Map());
    const rk = `${r.race_date}-${r.meet}-${r.rc_no}`;
    const m = byQuarter.get(qk)!;
    if (!m.has(rk)) m.set(rk, []);
    m.get(rk)!.push(r);
  }
  const quarters = [...byQuarter.keys()].sort();

  // ── 6. 집계 ───────────────────────────────────────────────────────────────
  // 누적
  const cumModel = emptyTally();
  const cumMkt = emptyTally();
  const cumV1 = emptyTally();

  // ROI (모델 단승 배당 기반)
  let roiSum = 0;
  let roiN = 0;

  // 묶음 (상위3 교집합)
  let setModelSum = 0;
  let setMktSum = 0;
  let setN = 0;

  // 불일치(모델 1픽 ≠ 시장 1픽) 구간
  const disModel = emptyTally();
  const disFav = emptyTally();

  // 출력 헤더
  console.log(
    '\n' +
    '분기      | 모델연승 | 시장연승 | v1연승 | 모델단승 | 모델묶음 | 시장묶음 | 모델ROI%  |   n'
  );
  console.log('-'.repeat(90));

  for (const qk of quarters) {
    const qModel = emptyTally();
    const qMkt = emptyTally();
    const qV1 = emptyTally();
    let qRoiSum = 0;
    let qRoiN = 0;
    let qSetModelSum = 0;
    let qSetMktSum = 0;
    let qSetN = 0;

    for (const [rk, horses] of byQuarter.get(qk)!) {
      // ── 모델 픽 ──────────────────────────────────────────────────────────
      // 각 말의 logit 계산 (학습 스키마 동일하게 toVector)
      const scored = horses.map((h) => ({
        row: h,
        logit: predictLogit(model, toVector(h.features, schema)),
      }));
      scored.sort((a, b) => b.logit - a.logit);
      const modelPick = scored[0]?.row ?? null;

      // ── 시장 픽 (win_odds 최소, 유효 배당만) ──────────────────────────────
      const validOdds = horses.filter(
        (h) => h.win_odds != null && h.win_odds > 0
      );
      validOdds.sort((a, b) => (a.win_odds as number) - (b.win_odds as number));
      const mktPick = validOdds[0] ?? null;

      // ── 단승/연승 집계 ────────────────────────────────────────────────────
      addRace(qModel, modelPick?.ord);
      addRace(qMkt, mktPick?.ord);

      // v1
      const v1Pick = v1Picks.get(rk);
      if (v1Pick) {
        addRace(qV1, v1Pick.actual_ord);
      }

      // ── ROI (모델 1픽, 단승 배당) ─────────────────────────────────────────
      if (modelPick && modelPick.win_odds != null && modelPick.win_odds > 0) {
        qRoiSum += modelPick.ord === 1 ? modelPick.win_odds : 0;
        qRoiN++;
      }

      // ── 묶음 교집합 (상위3 vs 실제 top3) ──────────────────────────────────
      const actualTop3 = new Set(
        horses.filter((h) => isShow(h.ord)).map((h) => h.hr_name)
      );
      if (actualTop3.size > 0) {
        qSetN++;
        setN++;
        const modelTop3 = scored.slice(0, 3).map((s) => s.row.hr_name);
        const mktTop3 = validOdds.slice(0, 3).map((h) => h.hr_name);
        const mHit = modelTop3.filter((n) => actualTop3.has(n)).length;
        const fHit = mktTop3.filter((n) => actualTop3.has(n)).length;
        qSetModelSum += mHit;
        qSetMktSum += fHit;
        setModelSum += mHit;
        setMktSum += fHit;
      }

      // ── 불일치 구간 ───────────────────────────────────────────────────────
      if (
        modelPick &&
        mktPick &&
        modelPick.hr_name !== mktPick.hr_name
      ) {
        addRace(disModel, modelPick.ord);
        addRace(disFav, mktPick.ord);
      }
    }

    // 누적 합산
    (['win', 'place', 'show', 'n'] as const).forEach((k) => {
      cumModel[k] += qModel[k];
      cumMkt[k] += qMkt[k];
      cumV1[k] += qV1[k];
    });
    roiSum += qRoiSum;
    roiN += qRoiN;

    const qRoi =
      qRoiN > 0
        ? (((qRoiSum / qRoiN) - 1) * 100).toFixed(1) + '%'
        : '-';
    const qMbundle =
      qSetN > 0 ? (qSetModelSum / qSetN).toFixed(2) : '-';
    const qFbundle =
      qSetN > 0 ? (qSetMktSum / qSetN).toFixed(2) : '-';

    console.log(
      `${qk.padEnd(9)} | ${pct(qModel.show, qModel.n).padStart(8)} | ` +
      `${pct(qMkt.show, qMkt.n).padStart(8)} | ` +
      `${pct(qV1.show, qV1.n).padStart(6)} | ` +
      `${pct(qModel.win, qModel.n).padStart(8)} | ` +
      `${qMbundle.padStart(8)} | ` +
      `${qFbundle.padStart(8)} | ` +
      `${qRoi.padStart(9)} | ${qModel.n}`
    );
  }

  // ── 7. 누적 결과 출력 ─────────────────────────────────────────────────────
  console.log('-'.repeat(90));
  const cumRoi =
    roiN > 0
      ? (((roiSum / roiN) - 1) * 100).toFixed(1) + '%'
      : '-';
  const cumMbundle = setN > 0 ? (setModelSum / setN).toFixed(2) : '-';
  const cumFbundle = setN > 0 ? (setMktSum / setN).toFixed(2) : '-';

  console.log(
    `${'누적'.padEnd(9)} | ${pct(cumModel.show, cumModel.n).padStart(8)} | ` +
    `${pct(cumMkt.show, cumMkt.n).padStart(8)} | ` +
    `${pct(cumV1.show, cumV1.n).padStart(6)} | ` +
    `${pct(cumModel.win, cumModel.n).padStart(8)} | ` +
    `${cumMbundle.padStart(8)} | ` +
    `${cumFbundle.padStart(8)} | ` +
    `${cumRoi.padStart(9)} | ${cumModel.n}`
  );

  // ── 8. 시장 비교 요약 ─────────────────────────────────────────────────────
  console.log('\n' + '-'.repeat(80));
  if (cumModel.n > 0 && cumMkt.n > 0) {
    const dMkt =
      ((cumModel.show / cumModel.n) - (cumMkt.show / cumMkt.n)) * 100;
    console.log(
      `[시장] 모델연승 − 시장연승 = ${dMkt >= 0 ? '+' : ''}${dMkt.toFixed(1)}%p  ` +
      `${dMkt >= 0 ? '(시장 우세 — 부가가치 O)' : '(시장에 뒤짐 — 부가가치 X)'}`
    );
  }

  // ── 9. 불일치 구간 ────────────────────────────────────────────────────────
  console.log('-'.repeat(80));
  console.log(
    `[불일치] 모델 1픽 ≠ 인기1위인 경주: ${disModel.n}건 (전체 ${cumModel.n}건 중 ${pct(disModel.n, cumModel.n)}%)`
  );
  if (disModel.n > 0) {
    console.log(`  모델픽   연승 ${pct(disModel.show, disModel.n)} / 단승 ${pct(disModel.win, disModel.n)}`);
    console.log(`  인기픽   연승 ${pct(disFav.show, disFav.n)} / 단승 ${pct(disFav.win, disFav.n)}`);
    const edge =
      ((disModel.show / disModel.n) - (disFav.show / disFav.n)) * 100;
    console.log(
      `  → 엇갈릴 때 연승 우위: ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%p  ` +
      `${edge >= 0 ? '(모델이 시장보다 나음)' : '(모델이 시장보다 못함)'}`
    );
  }

  // ── 10. 묶음 요약 ─────────────────────────────────────────────────────────
  console.log('-'.repeat(80));
  console.log('[상위3 묶음] 상위 3마리가 실제 top3를 평균 몇 마리 잡나 (0~3)');
  if (setN > 0) {
    const m = setModelSum / setN;
    const f = setMktSum / setN;
    const d = m - f;
    console.log(`  모델 ${m.toFixed(2)}마리  /  시장 ${f.toFixed(2)}마리  (n=${setN})`);
    console.log(
      `  → 묶음 우위: ${d >= 0 ? '+' : ''}${d.toFixed(2)}마리  ` +
      `${d >= 0 ? '(모델이 시장보다 잘 잡음)' : '(시장이 더 잘 잡음)'}`
    );
  }

  // ── 11. 노이즈 마진 경고 (모델연승 − v1연승) ─────────────────────────────
  console.log('-'.repeat(80));
  if (cumModel.n > 0 && cumV1.n > 0) {
    const diff =
      ((cumModel.show / cumModel.n) - (cumV1.show / cumV1.n)) * 100;
    const p = cumV1.show / cumV1.n;
    const se = Math.sqrt((p * (1 - p)) / cumModel.n) * 100 * 1.96;
    console.log(
      `[노이즈 마진] 모델연승 − v1연승 = ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p  ` +
      `|  대략 95% 표본오차 ±${se.toFixed(1)}%p`
    );
    console.log(
      Math.abs(diff) > se
        ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
        : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)'
    );
  }

  // ── 12. 최종 판정 ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  const modelBeatsMkt =
    cumModel.n > 0 && cumMkt.n > 0
      ? cumModel.show / cumModel.n > cumMkt.show / cumMkt.n
      : null;
  const modelBeatsV1 =
    cumModel.n > 0 && cumV1.n > 0
      ? cumModel.show / cumModel.n > cumV1.show / cumV1.n
      : null;

  console.log('【최종 판정】');
  console.log(
    `  모델 연승 vs v1  : ${modelBeatsV1 == null ? 'N/A' : modelBeatsV1 ? '✓ 모델 > v1' : '✗ 모델 ≤ v1'}`
  );
  console.log(
    `  모델 연승 vs 시장: ${modelBeatsMkt == null ? 'N/A' : modelBeatsMkt ? '✓ 모델 > 시장' : '✗ 모델 ≤ 시장'}`
  );
  console.log('  (사람이 최종 판단 — 노이즈 마진 확인 필수)\n');
}

main().catch((e: unknown) => {
  console.error('실험 실패:', e);
  process.exit(1);
});
