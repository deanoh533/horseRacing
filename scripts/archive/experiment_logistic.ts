/**
 * 오프라인 로지스틱 + GBDT 실험 — 훈련 행렬 JSONL 기반
 *
 * 시간 분할 (train < --split, test >= --split) 후
 * 로지스틱·GBDT 모델을 학습하고 테스트셋에서 지표를 측정한다.
 *
 * 지표: 연승(3착내)·단승(1착)·묶음(상위3 교집합)·ROI(단승 배당)
 * 비교: 로지스틱 vs GBDT vs MARKET(win_odds 최저) vs v1(predictions.predicted_rank=1)
 *
 * 사용:
 *   npm run exp:logistic
 *   npm run exp:logistic -- --matrix data/training_matrix.jsonl --split 20250101
 *   npm run exp:logistic -- --split 20250101 --walkforward
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as readline from 'readline';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { fitGBDT, predictGBDT } from '../src/engine/models/gbdt.js';
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

/** 분기 시작 날짜 (YYYYMMDD integer). q: 1~4 */
function qStart(y: number, q: number): number {
  const startMonth = (q - 1) * 3 + 1; // 1,4,7,10
  return y * 10000 + startMonth * 100 + 1;
}

/** 다음 분기 시작 날짜 */
function qNextStart(y: number, q: number): number {
  if (q < 4) return qStart(y, q + 1);
  return qStart(y + 1, 1);
}

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

// ─── 경주 그룹화 유틸 ────────────────────────────────────────────────────────

type RaceKey = string; // `${race_date}-${meet}-${rc_no}`
type RaceMap = Map<RaceKey, MatrixRow[]>;

function groupByRace(rows: MatrixRow[]): RaceMap {
  const m: RaceMap = new Map();
  for (const r of rows) {
    const rk: RaceKey = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!m.has(rk)) m.set(rk, []);
    m.get(rk)!.push(r);
  }
  return m;
}

// ─── 공통 경주 점수 집계 헬퍼 ────────────────────────────────────────────────
//
// 모델(logit) + GBDT + 시장 + v1 픽을 집계해 tally / ROI / 묶음 / 불일치 카운터를
// IN-PLACE로 업데이트한다. single-split과 walk-forward 양쪽에서 재사용.

interface ScoreAccumulators {
  model: Tally;
  mkt: Tally;
  v1: Tally;
  gbdt: Tally;
  roiSum: number;
  roiN: number;
  gbdtRoiSum: number;
  gbdtRoiN: number;
  setModelSum: number;
  setMktSum: number;
  setGbdtSum: number;
  setN: number;
  disModel: Tally;
  disFav: Tally;
}

function makeAccumulators(): ScoreAccumulators {
  return {
    model: emptyTally(),
    mkt: emptyTally(),
    v1: emptyTally(),
    gbdt: emptyTally(),
    roiSum: 0,
    roiN: 0,
    gbdtRoiSum: 0,
    gbdtRoiN: 0,
    setModelSum: 0,
    setMktSum: 0,
    setGbdtSum: 0,
    setN: 0,
    disModel: emptyTally(),
    disFav: emptyTally(),
  };
}

function mergeAccumulators(dst: ScoreAccumulators, src: ScoreAccumulators): void {
  (['win', 'place', 'show', 'n'] as const).forEach((k) => {
    dst.model[k] += src.model[k];
    dst.mkt[k] += src.mkt[k];
    dst.v1[k] += src.v1[k];
    dst.gbdt[k] += src.gbdt[k];
    dst.disModel[k] += src.disModel[k];
    dst.disFav[k] += src.disFav[k];
  });
  dst.roiSum += src.roiSum;
  dst.roiN += src.roiN;
  dst.gbdtRoiSum += src.gbdtRoiSum;
  dst.gbdtRoiN += src.gbdtRoiN;
  dst.setModelSum += src.setModelSum;
  dst.setMktSum += src.setMktSum;
  dst.setGbdtSum += src.setGbdtSum;
  dst.setN += src.setN;
}

/**
 * raceMap(경주별 rows)을 logistic/gbdt 모델로 점수화하고 accum을 IN-PLACE 갱신.
 * schema는 해당 모델을 학습한 train 스키마여야 한다.
 */
function scoreRaceMap(
  raceMap: RaceMap,
  logitWeights: ReturnType<typeof fitLogistic>,
  gbdtModel: ReturnType<typeof fitGBDT>,
  schema: string[],
  v1Picks: Map<string, V1Pick>,
  accum: ScoreAccumulators
): void {
  for (const [rk, horses] of raceMap) {
    // ── 모델 픽 ──────────────────────────────────────────────────────────
    const scored = horses.map((h) => ({
      row: h,
      logit: predictLogit(logitWeights, toVector(h.features, schema)),
    }));
    scored.sort((a, b) => b.logit - a.logit);
    const modelPick = scored[0]?.row ?? null;

    // ── GBDT 픽 (동일 schema로 toVector — 학습 스키마 일치 보장) ──────────
    const gbdtScored = horses.map((h) => ({
      row: h,
      score: predictGBDT(gbdtModel, toVector(h.features, schema)),
    }));
    gbdtScored.sort((a, b) => b.score - a.score);
    const gbdtPick = gbdtScored[0]?.row ?? null;

    // ── 시장 픽 (win_odds 최소, 유효 배당만) ──────────────────────────────
    const validOdds = horses.filter(
      (h) => h.win_odds != null && h.win_odds > 0
    );
    validOdds.sort((a, b) => (a.win_odds as number) - (b.win_odds as number));
    const mktPick = validOdds[0] ?? null;

    // ── 단승/연승 집계 ────────────────────────────────────────────────────
    addRace(accum.model, modelPick?.ord);
    addRace(accum.mkt, mktPick?.ord);
    addRace(accum.gbdt, gbdtPick?.ord);

    // v1
    const v1Pick = v1Picks.get(rk);
    if (v1Pick) {
      addRace(accum.v1, v1Pick.actual_ord);
    }

    // ── ROI (모델 1픽, 단승 배당) ─────────────────────────────────────────
    if (modelPick && modelPick.win_odds != null && modelPick.win_odds > 0) {
      accum.roiSum += modelPick.ord === 1 ? modelPick.win_odds : 0;
      accum.roiN++;
    }

    // ── ROI GBDT ─────────────────────────────────────────────────────────
    if (gbdtPick && gbdtPick.win_odds != null && gbdtPick.win_odds > 0) {
      accum.gbdtRoiSum += gbdtPick.ord === 1 ? gbdtPick.win_odds : 0;
      accum.gbdtRoiN++;
    }

    // ── 묶음 교집합 (상위3 vs 실제 top3) ──────────────────────────────────
    const actualTop3 = new Set(
      horses.filter((h) => isShow(h.ord)).map((h) => h.hr_name)
    );
    if (actualTop3.size > 0) {
      accum.setN++;
      const modelTop3 = scored.slice(0, 3).map((s) => s.row.hr_name);
      const mktTop3 = validOdds.slice(0, 3).map((h) => h.hr_name);
      const gbdtTop3 = gbdtScored.slice(0, 3).map((s) => s.row.hr_name);
      accum.setModelSum += modelTop3.filter((n) => actualTop3.has(n)).length;
      accum.setMktSum += mktTop3.filter((n) => actualTop3.has(n)).length;
      accum.setGbdtSum += gbdtTop3.filter((n) => actualTop3.has(n)).length;
    }

    // ── 불일치 구간 ───────────────────────────────────────────────────────
    if (modelPick && mktPick && modelPick.hr_name !== mktPick.hr_name) {
      addRace(accum.disModel, modelPick.ord);
      addRace(accum.disFav, mktPick.ord);
    }
  }
}

// ─── 요약 출력 헬퍼 (시장비교·불일치·묶음·노이즈마진·최종판정) ───────────────

function printSummary(
  cum: ScoreAccumulators,
  label: string
): void {
  const { model: cumModel, mkt: cumMkt, v1: cumV1, gbdt: cumGbdt } = cum;
  const roiN = cum.roiN;
  const roiSum = cum.roiSum;
  const gbdtRoiN = cum.gbdtRoiN;
  const gbdtRoiSum = cum.gbdtRoiSum;
  const setN = cum.setN;
  const setModelSum = cum.setModelSum;
  const setMktSum = cum.setMktSum;
  const setGbdtSum = cum.setGbdtSum;
  const disModel = cum.disModel;
  const disFav = cum.disFav;

  // 시장 비교 요약
  console.log('\n' + '-'.repeat(80));
  if (cumModel.n > 0 && cumMkt.n > 0) {
    const dMkt =
      ((cumModel.show / cumModel.n) - (cumMkt.show / cumMkt.n)) * 100;
    console.log(
      `[시장] 모델연승 − 시장연승 = ${dMkt >= 0 ? '+' : ''}${dMkt.toFixed(1)}%p  ` +
      `${dMkt >= 0 ? '(모델 우세 — 부가가치 O)' : '(시장에 뒤짐 — 부가가치 X)'}  (모델 n=${cumModel.n}, 시장 n=${cumMkt.n})`
    );
  }

  // 불일치 구간
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

  // 묶음 요약
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

  // 노이즈 마진 (모델연승 − v1연승)
  console.log('-'.repeat(80));
  if (cumModel.n > 0 && cumV1.n > 0) {
    const diff =
      ((cumModel.show / cumModel.n) - (cumV1.show / cumV1.n)) * 100;
    const p = cumV1.show / cumV1.n;
    const se = Math.sqrt((p * (1 - p)) / cumModel.n) * 100 * 1.96;
    console.log(
      `[노이즈 마진] 모델연승 − v1연승 = ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p  ` +
      `|  대략 95% 표본오차 ±${se.toFixed(1)}%p  (v1 n=${cumV1.n})`
    );
    console.log(
      Math.abs(diff) > se
        ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
        : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)'
    );
  }

  // GBDT 누적
  const cumGbdtRoi =
    gbdtRoiN > 0
      ? (((gbdtRoiSum / gbdtRoiN) - 1) * 100).toFixed(1) + '%'
      : '-';
  const cumGbundle = setN > 0 ? (setGbdtSum / setN).toFixed(2) : '-';

  // 최종 판정
  console.log('\n' + '='.repeat(80));
  const modelBeatsMkt =
    cumModel.n > 0 && cumMkt.n > 0
      ? cumModel.show / cumModel.n > cumMkt.show / cumMkt.n
      : null;
  const modelBeatsV1 =
    cumModel.n > 0 && cumV1.n > 0
      ? cumModel.show / cumModel.n > cumV1.show / cumV1.n
      : null;
  const gbdtBeatsLogistic =
    cumGbdt.n > 0 && cumModel.n > 0
      ? cumGbdt.show / cumGbdt.n > cumModel.show / cumModel.n
      : null;
  const gbdtBeatsV1 =
    cumGbdt.n > 0 && cumV1.n > 0
      ? cumGbdt.show / cumGbdt.n > cumV1.show / cumV1.n
      : null;
  const gbdtBeatsMkt =
    cumGbdt.n > 0 && cumMkt.n > 0
      ? cumGbdt.show / cumGbdt.n > cumMkt.show / cumMkt.n
      : null;
  const gbdtVsLogisticDelta =
    cumGbdt.n > 0 && cumModel.n > 0
      ? ((cumGbdt.show / cumGbdt.n) - (cumModel.show / cumModel.n)) * 100
      : null;

  console.log(`【최종 판정 — 로지스틱】${label ? ' (' + label + ')' : ''}`);
  console.log(
    `  모델 연승 vs v1  : ${modelBeatsV1 == null ? 'N/A' : modelBeatsV1 ? '✓ 모델 > v1' : '✗ 모델 ≤ v1'}`
  );
  console.log(
    `  모델 연승 vs 시장: ${modelBeatsMkt == null ? 'N/A' : modelBeatsMkt ? '✓ 모델 > 시장' : '✗ 모델 ≤ 시장'}`
  );
  console.log('');

  console.log(`【최종 판정 — GBDT】${label ? ' (' + label + ')' : ''}`);
  console.log(
    `  GBDT 연승 vs 로지스틱: ${gbdtBeatsLogistic == null ? 'N/A' : gbdtBeatsLogistic ? '✓' : '✗'}` +
    (gbdtVsLogisticDelta != null
      ? `  Δ${gbdtVsLogisticDelta >= 0 ? '+' : ''}${gbdtVsLogisticDelta.toFixed(1)}%p`
      : '')
  );
  console.log(
    `  GBDT 연승 vs v1      : ${gbdtBeatsV1 == null ? 'N/A' : gbdtBeatsV1 ? '✓' : '✗'}`
  );
  console.log(
    `  GBDT 연승 vs 시장    : ${gbdtBeatsMkt == null ? 'N/A' : gbdtBeatsMkt ? '✓' : '✗'}`
  );

  // 노이즈 마진 (GBDT연승 − 로지스틱연승)
  if (gbdtVsLogisticDelta != null && cumModel.n > 0) {
    const pBase = cumModel.show / cumModel.n;
    const se = Math.sqrt((pBase * (1 - pBase)) / cumModel.n) * 100 * 1.96;
    console.log(
      `  [노이즈 마진] GBDT연승 − 로지스틱연승 = ${gbdtVsLogisticDelta >= 0 ? '+' : ''}${gbdtVsLogisticDelta.toFixed(1)}%p` +
      `  |  대략 95% 표본오차 ±${se.toFixed(1)}%p`
    );
    console.log(
      '  ' + (Math.abs(gbdtVsLogisticDelta) > se
        ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
        : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)')
    );
  }

  console.log('  (사람이 최종 판단 — 노이즈 마진 확인 필수)\n');

  // GBDT ROI 출력 (참고)
  void cumGbdtRoi; // used in per-quarter section; here just for completeness
  void cumGbundle;
}

// ─── 메인 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const matrixIdx = args.indexOf('--matrix');
  const matrixPath = matrixIdx >= 0 ? args[matrixIdx + 1]! : 'data/training_matrix.jsonl';

  const splitIdx = args.indexOf('--split');
  const splitDate = splitIdx >= 0 ? Number(args[splitIdx + 1]) : 20250101;

  const walkForward = args.includes('--walkforward');

  if (walkForward) {
    console.log(`\n로지스틱 실험 【확장윈도우 walk-forward 모드】 — 행렬: ${matrixPath}  |  테스트 시작: ${splitDate}`);
  } else {
    console.log(`\n로지스틱 실험 — 행렬: ${matrixPath}  |  분할: ${splitDate}`);
  }
  console.log('='.repeat(80));

  // ── 1. JSONL 로드 ──────────────────────────────────────────────────────────
  if (!fs.existsSync(matrixPath)) {
    console.error(`행렬 파일 없음: ${matrixPath}`);
    process.exit(1);
  }
  const allRows = await loadMatrix(matrixPath);

  if (!walkForward) {
    // ════════════════════════════════════════════════════════════════════════
    //  단일 분할 모드 (기존 동작 — 출력 byte-identical)
    // ════════════════════════════════════════════════════════════════════════

    const trainRows = allRows.filter((r) => r.race_date < splitDate);
    const testRows = allRows.filter((r) => r.race_date >= splitDate);
    console.log(`총 ${allRows.length}행  →  학습 ${trainRows.length}행 / 테스트 ${testRows.length}행`);

    if (trainRows.length === 0) throw new Error('학습 행 없음. --split 값 확인');
    if (testRows.length === 0) throw new Error('테스트 행 없음. --split 값 확인');

    // 스키마 + 행렬 구성 (학습)
    const schema = buildSchema(trainRows.map((r) => r.features));
    if (schema.length === 0) throw new Error('피처 스키마가 비었습니다 (train 행렬 확인)');
    const Xtr = trainRows.map((r) => toVector(r.features, schema));
    const ytr = trainRows.map((r) => r.top3);

    console.log(`피처 수: ${schema.length}`);

    // 로지스틱 학습
    const model = fitLogistic(Xtr, ytr as number[], schema, {
      l2: 0.02,
      iters: 800,
      lr: 0.2,
    });

    // GBDT 학습
    const gbdt = fitGBDT(Xtr, ytr as number[], schema, {
      rounds: 120,
      maxDepth: 4,
      lr: 0.2,
      lambda: 1,
      minChild: 30,
      bins: 64,
    });
    console.log(`GBDT 학습 완료 (트리 ${gbdt.trees.length}개)`);

    // v1 베이스라인 로드
    const sb = getSupabaseAdmin();
    const testDates = new Set(testRows.map((r) => r.race_date));
    console.log(`v1 베이스라인 로드 중 (predictions)...`);
    const v1Picks = await fetchV1Picks(sb, testDates);
    console.log(`v1 피크 ${v1Picks.size}개 경주`);

    // 테스트 행 그룹화: 분기 → 경주
    type QKey = string;   // `${year}-Q${q}`
    const byQuarter = new Map<QKey, RaceMap>();

    for (const r of testRows) {
      const { year, q } = quarterOf(r.race_date);
      const qk = qKey(year, q);
      if (!byQuarter.has(qk)) byQuarter.set(qk, new Map());
      const rk: RaceKey = `${r.race_date}-${r.meet}-${r.rc_no}`;
      const m = byQuarter.get(qk)!;
      if (!m.has(rk)) m.set(rk, []);
      m.get(rk)!.push(r);
    }
    const quarters = [...byQuarter.keys()].sort();

    // 누적 집계
    const cumAccum = makeAccumulators();

    // 출력 헤더 (로지스틱 블록)
    console.log(
      '\n[로지스틱]\n' +
      '분기      | 모델연승 | 시장연승 | v1연승 | 모델단승 | 시장단승 | v1단승 | 모델묶음 | 시장묶음 | 모델ROI%  |   n'
    );
    console.log('-'.repeat(110));

    // GBDT 분기별 집계를 위한 버퍼 (출력 시 별도 블록으로 표시)
    interface QGbdtBuf {
      tally: Tally;
      roiSum: number; roiN: number;
      setSum: number; setN: number;
    }
    const gbdtQuarterBufs = new Map<string, QGbdtBuf>();

    for (const qk of quarters) {
      const qAccum = makeAccumulators();

      scoreRaceMap(byQuarter.get(qk)!, model, gbdt, schema, v1Picks, qAccum);

      mergeAccumulators(cumAccum, qAccum);

      // GBDT 분기 버퍼 저장
      gbdtQuarterBufs.set(qk, {
        tally: qAccum.gbdt,
        roiSum: qAccum.gbdtRoiSum,
        roiN: qAccum.gbdtRoiN,
        setSum: qAccum.setGbdtSum,
        setN: qAccum.setN,
      });

      const qRoi =
        qAccum.roiN > 0
          ? (((qAccum.roiSum / qAccum.roiN) - 1) * 100).toFixed(1) + '%'
          : '-';
      const qMbundle =
        qAccum.setN > 0 ? (qAccum.setModelSum / qAccum.setN).toFixed(2) : '-';
      const qFbundle =
        qAccum.setN > 0 ? (qAccum.setMktSum / qAccum.setN).toFixed(2) : '-';

      console.log(
        `${qk.padEnd(9)} | ${pct(qAccum.model.show, qAccum.model.n).padStart(8)} | ` +
        `${pct(qAccum.mkt.show, qAccum.mkt.n).padStart(8)} | ` +
        `${pct(qAccum.v1.show, qAccum.v1.n).padStart(6)} | ` +
        `${pct(qAccum.model.win, qAccum.model.n).padStart(8)} | ` +
        `${pct(qAccum.mkt.win, qAccum.mkt.n).padStart(8)} | ` +
        `${pct(qAccum.v1.win, qAccum.v1.n).padStart(6)} | ` +
        `${qMbundle.padStart(8)} | ` +
        `${qFbundle.padStart(8)} | ` +
        `${qRoi.padStart(9)} | ${qAccum.model.n}`
      );
    }

    // 누적 결과 출력 (로지스틱)
    console.log('-'.repeat(110));
    const cumRoi =
      cumAccum.roiN > 0
        ? (((cumAccum.roiSum / cumAccum.roiN) - 1) * 100).toFixed(1) + '%'
        : '-';
    const cumMbundle = cumAccum.setN > 0 ? (cumAccum.setModelSum / cumAccum.setN).toFixed(2) : '-';
    const cumFbundle = cumAccum.setN > 0 ? (cumAccum.setMktSum / cumAccum.setN).toFixed(2) : '-';

    console.log(
      `${'누적'.padEnd(9)} | ${pct(cumAccum.model.show, cumAccum.model.n).padStart(8)} | ` +
      `${pct(cumAccum.mkt.show, cumAccum.mkt.n).padStart(8)} | ` +
      `${pct(cumAccum.v1.show, cumAccum.v1.n).padStart(6)} | ` +
      `${pct(cumAccum.model.win, cumAccum.model.n).padStart(8)} | ` +
      `${pct(cumAccum.mkt.win, cumAccum.mkt.n).padStart(8)} | ` +
      `${pct(cumAccum.v1.win, cumAccum.v1.n).padStart(6)} | ` +
      `${cumMbundle.padStart(8)} | ` +
      `${cumFbundle.padStart(8)} | ` +
      `${cumRoi.padStart(9)} | ${cumAccum.model.n}`
    );

    // 시장 비교·불일치·묶음·노이즈마진
    console.log('\n' + '-'.repeat(80));
    if (cumAccum.model.n > 0 && cumAccum.mkt.n > 0) {
      const dMkt =
        ((cumAccum.model.show / cumAccum.model.n) - (cumAccum.mkt.show / cumAccum.mkt.n)) * 100;
      console.log(
        `[시장] 모델연승 − 시장연승 = ${dMkt >= 0 ? '+' : ''}${dMkt.toFixed(1)}%p  ` +
        `${dMkt >= 0 ? '(모델 우세 — 부가가치 O)' : '(시장에 뒤짐 — 부가가치 X)'}  (모델 n=${cumAccum.model.n}, 시장 n=${cumAccum.mkt.n})`
      );
    }

    console.log('-'.repeat(80));
    console.log(
      `[불일치] 모델 1픽 ≠ 인기1위인 경주: ${cumAccum.disModel.n}건 (전체 ${cumAccum.model.n}건 중 ${pct(cumAccum.disModel.n, cumAccum.model.n)}%)`
    );
    if (cumAccum.disModel.n > 0) {
      console.log(`  모델픽   연승 ${pct(cumAccum.disModel.show, cumAccum.disModel.n)} / 단승 ${pct(cumAccum.disModel.win, cumAccum.disModel.n)}`);
      console.log(`  인기픽   연승 ${pct(cumAccum.disFav.show, cumAccum.disFav.n)} / 단승 ${pct(cumAccum.disFav.win, cumAccum.disFav.n)}`);
      const edge =
        ((cumAccum.disModel.show / cumAccum.disModel.n) - (cumAccum.disFav.show / cumAccum.disFav.n)) * 100;
      console.log(
        `  → 엇갈릴 때 연승 우위: ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%p  ` +
        `${edge >= 0 ? '(모델이 시장보다 나음)' : '(모델이 시장보다 못함)'}`
      );
    }

    console.log('-'.repeat(80));
    console.log('[상위3 묶음] 상위 3마리가 실제 top3를 평균 몇 마리 잡나 (0~3)');
    if (cumAccum.setN > 0) {
      const m = cumAccum.setModelSum / cumAccum.setN;
      const f = cumAccum.setMktSum / cumAccum.setN;
      const d = m - f;
      console.log(`  모델 ${m.toFixed(2)}마리  /  시장 ${f.toFixed(2)}마리  (n=${cumAccum.setN})`);
      console.log(
        `  → 묶음 우위: ${d >= 0 ? '+' : ''}${d.toFixed(2)}마리  ` +
        `${d >= 0 ? '(모델이 시장보다 잘 잡음)' : '(시장이 더 잘 잡음)'}`
      );
    }

    console.log('-'.repeat(80));
    if (cumAccum.model.n > 0 && cumAccum.v1.n > 0) {
      const diff =
        ((cumAccum.model.show / cumAccum.model.n) - (cumAccum.v1.show / cumAccum.v1.n)) * 100;
      const p = cumAccum.v1.show / cumAccum.v1.n;
      const se = Math.sqrt((p * (1 - p)) / cumAccum.model.n) * 100 * 1.96;
      console.log(
        `[노이즈 마진] 모델연승 − v1연승 = ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p  ` +
        `|  대략 95% 표본오차 ±${se.toFixed(1)}%p  (v1 n=${cumAccum.v1.n})`
      );
      console.log(
        Math.abs(diff) > se
          ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
          : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)'
      );
    }

    // GBDT 블록 출력
    console.log('\n\n[GBDT]\n분기      | GBDT연승 | GBDT단승 | GBDT묶음 | GBDTROI%  |   n');
    console.log('-'.repeat(60));

    for (const qk of quarters) {
      const buf = gbdtQuarterBufs.get(qk)!;
      const qGbdtRoi =
        buf.roiN > 0
          ? (((buf.roiSum / buf.roiN) - 1) * 100).toFixed(1) + '%'
          : '-';
      const qGbundle =
        buf.setN > 0 ? (buf.setSum / buf.setN).toFixed(2) : '-';
      console.log(
        `${qk.padEnd(9)} | ${pct(buf.tally.show, buf.tally.n).padStart(8)} | ` +
        `${pct(buf.tally.win, buf.tally.n).padStart(8)} | ` +
        `${qGbundle.padStart(8)} | ` +
        `${qGbdtRoi.padStart(9)} | ${buf.tally.n}`
      );
    }

    console.log('-'.repeat(60));
    const cumGbdtRoi =
      cumAccum.gbdtRoiN > 0
        ? (((cumAccum.gbdtRoiSum / cumAccum.gbdtRoiN) - 1) * 100).toFixed(1) + '%'
        : '-';
    const cumGbundle = cumAccum.setN > 0 ? (cumAccum.setGbdtSum / cumAccum.setN).toFixed(2) : '-';
    console.log(
      `${'누적'.padEnd(9)} | ${pct(cumAccum.gbdt.show, cumAccum.gbdt.n).padStart(8)} | ` +
      `${pct(cumAccum.gbdt.win, cumAccum.gbdt.n).padStart(8)} | ` +
      `${cumGbundle.padStart(8)} | ` +
      `${cumGbdtRoi.padStart(9)} | ${cumAccum.gbdt.n}`
    );

    // 최종 판정
    console.log('\n' + '='.repeat(80));
    const modelBeatsMkt =
      cumAccum.model.n > 0 && cumAccum.mkt.n > 0
        ? cumAccum.model.show / cumAccum.model.n > cumAccum.mkt.show / cumAccum.mkt.n
        : null;
    const modelBeatsV1 =
      cumAccum.model.n > 0 && cumAccum.v1.n > 0
        ? cumAccum.model.show / cumAccum.model.n > cumAccum.v1.show / cumAccum.v1.n
        : null;
    const gbdtBeatsLogistic =
      cumAccum.gbdt.n > 0 && cumAccum.model.n > 0
        ? cumAccum.gbdt.show / cumAccum.gbdt.n > cumAccum.model.show / cumAccum.model.n
        : null;
    const gbdtBeatsV1 =
      cumAccum.gbdt.n > 0 && cumAccum.v1.n > 0
        ? cumAccum.gbdt.show / cumAccum.gbdt.n > cumAccum.v1.show / cumAccum.v1.n
        : null;
    const gbdtBeatsMkt =
      cumAccum.gbdt.n > 0 && cumAccum.mkt.n > 0
        ? cumAccum.gbdt.show / cumAccum.gbdt.n > cumAccum.mkt.show / cumAccum.mkt.n
        : null;
    const gbdtVsLogisticDelta =
      cumAccum.gbdt.n > 0 && cumAccum.model.n > 0
        ? ((cumAccum.gbdt.show / cumAccum.gbdt.n) - (cumAccum.model.show / cumAccum.model.n)) * 100
        : null;

    console.log('【최종 판정 — 로지스틱】');
    console.log(
      `  모델 연승 vs v1  : ${modelBeatsV1 == null ? 'N/A' : modelBeatsV1 ? '✓ 모델 > v1' : '✗ 모델 ≤ v1'}`
    );
    console.log(
      `  모델 연승 vs 시장: ${modelBeatsMkt == null ? 'N/A' : modelBeatsMkt ? '✓ 모델 > 시장' : '✗ 모델 ≤ 시장'}`
    );
    console.log('');

    console.log('【최종 판정 — GBDT】');
    console.log(
      `  GBDT 연승 vs 로지스틱: ${gbdtBeatsLogistic == null ? 'N/A' : gbdtBeatsLogistic ? '✓' : '✗'}` +
      (gbdtVsLogisticDelta != null
        ? `  Δ${gbdtVsLogisticDelta >= 0 ? '+' : ''}${gbdtVsLogisticDelta.toFixed(1)}%p`
        : '')
    );
    console.log(
      `  GBDT 연승 vs v1      : ${gbdtBeatsV1 == null ? 'N/A' : gbdtBeatsV1 ? '✓' : '✗'}`
    );
    console.log(
      `  GBDT 연승 vs 시장    : ${gbdtBeatsMkt == null ? 'N/A' : gbdtBeatsMkt ? '✓' : '✗'}`
    );

    if (gbdtVsLogisticDelta != null && cumAccum.model.n > 0) {
      const pBase = cumAccum.model.show / cumAccum.model.n;
      const se = Math.sqrt((pBase * (1 - pBase)) / cumAccum.model.n) * 100 * 1.96;
      console.log(
        `  [노이즈 마진] GBDT연승 − 로지스틱연승 = ${gbdtVsLogisticDelta >= 0 ? '+' : ''}${gbdtVsLogisticDelta.toFixed(1)}%p` +
        `  |  대략 95% 표본오차 ±${se.toFixed(1)}%p`
      );
      console.log(
        '  ' + (Math.abs(gbdtVsLogisticDelta) > se
          ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
          : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)')
      );
    }

    console.log('  (사람이 최종 판단 — 노이즈 마진 확인 필수)\n');

    return; // ── 단일 분할 모드 끝 ──
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  확장윈도우 Walk-forward 모드
  // ════════════════════════════════════════════════════════════════════════════

  const trainBase = allRows.filter((r) => r.race_date < splitDate);
  const testAllRows = allRows.filter((r) => r.race_date >= splitDate);

  console.log(`총 ${allRows.length}행  →  기준 학습 ${trainBase.length}행 / 테스트 전체 ${testAllRows.length}행`);

  if (trainBase.length === 0) throw new Error('학습 기준 행 없음. --split 값 확인');
  if (testAllRows.length === 0) throw new Error('테스트 행 없음. --split 값 확인');

  // 테스트 분기 목록 결정 (오름차순)
  const testQSet = new Set<string>();
  for (const r of testAllRows) {
    const { year, q } = quarterOf(r.race_date);
    testQSet.add(qKey(year, q));
  }
  const testQuarters = [...testQSet].sort(); // e.g. ["2025-Q1","2025-Q2",...]

  console.log(`테스트 분기: ${testQuarters.join(', ')}`);

  // v1 피크: 모든 테스트 기간에 대해 한 번만 fetch
  const sb = getSupabaseAdmin();
  const testDates = new Set(testAllRows.map((r) => r.race_date));
  console.log(`v1 베이스라인 로드 중 (predictions)...`);
  const v1Picks = await fetchV1Picks(sb, testDates);
  console.log(`v1 피크 ${v1Picks.size}개 경주`);

  // 분기 날짜 범위 파싱 헬퍼
  function parseQKey(qk: string): { year: number; q: number } {
    const [yStr, qStr] = qk.split('-Q');
    return { year: Number(yStr), q: Number(qStr) };
  }

  // 누적 집계 (모든 분기)
  const wfCum = makeAccumulators();

  // GBDT 분기별 버퍼 (walk-forward 출력용)
  interface QGbdtBuf {
    tally: Tally;
    roiSum: number; roiN: number;
    setSum: number; setN: number;
    trainSize: number;
  }
  const wfGbdtBufs = new Map<string, QGbdtBuf>();

  // 로지스틱 헤더
  console.log(
    '\n[walk-forward / 로지스틱]\n' +
    '분기      | 학습크기  | 모델연승 | 시장연승 | v1연승 | 모델단승 | 시장단승 | v1단승 | 모델묶음 | 시장묶음 | 모델ROI%  |   n'
  );
  console.log('-'.repeat(126));

  for (const qk of testQuarters) {
    const { year, q } = parseQKey(qk);
    const qs = qStart(year, q);
    const qe = qNextStart(year, q);

    // 확장 학습셋: base (< splitDate) + 이전 테스트 분기들 (< qs)
    // = 전체 중 race_date < qs 인 행
    const trainRows = allRows.filter((r) => r.race_date < qs);
    const qTestRows = testAllRows.filter(
      (r) => r.race_date >= qs && r.race_date < qe
    );

    if (trainRows.length === 0 || qTestRows.length === 0) {
      console.log(`${qk.padEnd(9)} | skip (train=${trainRows.length}, test=${qTestRows.length})`);
      continue;
    }

    // 이 분기 전용 스키마 + 모델 학습
    const schema = buildSchema(trainRows.map((r) => r.features));
    const Xtr = trainRows.map((r) => toVector(r.features, schema));
    const ytr = trainRows.map((r) => r.top3);

    const model = fitLogistic(Xtr, ytr as number[], schema, {
      l2: 0.02,
      iters: 800,
      lr: 0.2,
    });
    const gbdt = fitGBDT(Xtr, ytr as number[], schema, {
      rounds: 120,
      maxDepth: 4,
      lr: 0.2,
      lambda: 1,
      minChild: 30,
      bins: 64,
    });

    // 테스트 경주 그룹화
    const qRaceMap = groupByRace(qTestRows);

    // 점수화
    const qAccum = makeAccumulators();
    scoreRaceMap(qRaceMap, model, gbdt, schema, v1Picks, qAccum);

    mergeAccumulators(wfCum, qAccum);

    // GBDT 버퍼 저장
    wfGbdtBufs.set(qk, {
      tally: qAccum.gbdt,
      roiSum: qAccum.gbdtRoiSum,
      roiN: qAccum.gbdtRoiN,
      setSum: qAccum.setGbdtSum,
      setN: qAccum.setN,
      trainSize: trainRows.length,
    });

    const qRoi =
      qAccum.roiN > 0
        ? (((qAccum.roiSum / qAccum.roiN) - 1) * 100).toFixed(1) + '%'
        : '-';
    const qMbundle =
      qAccum.setN > 0 ? (qAccum.setModelSum / qAccum.setN).toFixed(2) : '-';
    const qFbundle =
      qAccum.setN > 0 ? (qAccum.setMktSum / qAccum.setN).toFixed(2) : '-';

    // 진행 상황 출력 (per-quarter)
    console.log(
      `${qk.padEnd(9)} | ${String(trainRows.length).padStart(9)} | ` +
      `${pct(qAccum.model.show, qAccum.model.n).padStart(8)} | ` +
      `${pct(qAccum.mkt.show, qAccum.mkt.n).padStart(8)} | ` +
      `${pct(qAccum.v1.show, qAccum.v1.n).padStart(6)} | ` +
      `${pct(qAccum.model.win, qAccum.model.n).padStart(8)} | ` +
      `${pct(qAccum.mkt.win, qAccum.mkt.n).padStart(8)} | ` +
      `${pct(qAccum.v1.win, qAccum.v1.n).padStart(6)} | ` +
      `${qMbundle.padStart(8)} | ` +
      `${qFbundle.padStart(8)} | ` +
      `${qRoi.padStart(9)} | ${qAccum.model.n}`
    );
  }

  // 누적 결과 (로지스틱)
  console.log('-'.repeat(126));
  const wfCumRoi =
    wfCum.roiN > 0
      ? (((wfCum.roiSum / wfCum.roiN) - 1) * 100).toFixed(1) + '%'
      : '-';
  const wfCumMbundle = wfCum.setN > 0 ? (wfCum.setModelSum / wfCum.setN).toFixed(2) : '-';
  const wfCumFbundle = wfCum.setN > 0 ? (wfCum.setMktSum / wfCum.setN).toFixed(2) : '-';

  console.log(
    `${'누적'.padEnd(9)} | ${' '.repeat(9)} | ` +
    `${pct(wfCum.model.show, wfCum.model.n).padStart(8)} | ` +
    `${pct(wfCum.mkt.show, wfCum.mkt.n).padStart(8)} | ` +
    `${pct(wfCum.v1.show, wfCum.v1.n).padStart(6)} | ` +
    `${pct(wfCum.model.win, wfCum.model.n).padStart(8)} | ` +
    `${pct(wfCum.mkt.win, wfCum.mkt.n).padStart(8)} | ` +
    `${pct(wfCum.v1.win, wfCum.v1.n).padStart(6)} | ` +
    `${wfCumMbundle.padStart(8)} | ` +
    `${wfCumFbundle.padStart(8)} | ` +
    `${wfCumRoi.padStart(9)} | ${wfCum.model.n}`
  );

  // GBDT walk-forward 블록
  console.log('\n\n[walk-forward / GBDT]\n분기      | 학습크기  | GBDT연승 | GBDT단승 | GBDT묶음 | GBDTROI%  |   n');
  console.log('-'.repeat(76));

  for (const qk of testQuarters) {
    const buf = wfGbdtBufs.get(qk);
    if (!buf) continue;
    const qGbdtRoi =
      buf.roiN > 0
        ? (((buf.roiSum / buf.roiN) - 1) * 100).toFixed(1) + '%'
        : '-';
    const qGbundle =
      buf.setN > 0 ? (buf.setSum / buf.setN).toFixed(2) : '-';
    console.log(
      `${qk.padEnd(9)} | ${String(buf.trainSize).padStart(9)} | ` +
      `${pct(buf.tally.show, buf.tally.n).padStart(8)} | ` +
      `${pct(buf.tally.win, buf.tally.n).padStart(8)} | ` +
      `${qGbundle.padStart(8)} | ` +
      `${qGbdtRoi.padStart(9)} | ${buf.tally.n}`
    );
  }

  console.log('-'.repeat(76));
  const wfCumGbdtRoi =
    wfCum.gbdtRoiN > 0
      ? (((wfCum.gbdtRoiSum / wfCum.gbdtRoiN) - 1) * 100).toFixed(1) + '%'
      : '-';
  const wfCumGbundle = wfCum.setN > 0 ? (wfCum.setGbdtSum / wfCum.setN).toFixed(2) : '-';
  console.log(
    `${'누적'.padEnd(9)} | ${' '.repeat(9)} | ` +
    `${pct(wfCum.gbdt.show, wfCum.gbdt.n).padStart(8)} | ` +
    `${pct(wfCum.gbdt.win, wfCum.gbdt.n).padStart(8)} | ` +
    `${wfCumGbundle.padStart(8)} | ` +
    `${wfCumGbdtRoi.padStart(9)} | ${wfCum.gbdt.n}`
  );

  // 시장 비교·불일치·묶음·노이즈마진·최종 판정 (walk-forward 누적)
  {
    const cum = wfCum;
    const { model: cumModel, mkt: cumMkt, v1: cumV1, gbdt: cumGbdt } = cum;

    console.log('\n' + '-'.repeat(80));
    if (cumModel.n > 0 && cumMkt.n > 0) {
      const dMkt =
        ((cumModel.show / cumModel.n) - (cumMkt.show / cumMkt.n)) * 100;
      console.log(
        `[시장] 모델연승 − 시장연승 = ${dMkt >= 0 ? '+' : ''}${dMkt.toFixed(1)}%p  ` +
        `${dMkt >= 0 ? '(모델 우세 — 부가가치 O)' : '(시장에 뒤짐 — 부가가치 X)'}  (모델 n=${cumModel.n}, 시장 n=${cumMkt.n})`
      );
    }

    console.log('-'.repeat(80));
    console.log(
      `[불일치] 모델 1픽 ≠ 인기1위인 경주: ${cum.disModel.n}건 (전체 ${cumModel.n}건 중 ${pct(cum.disModel.n, cumModel.n)}%)`
    );
    if (cum.disModel.n > 0) {
      console.log(`  모델픽   연승 ${pct(cum.disModel.show, cum.disModel.n)} / 단승 ${pct(cum.disModel.win, cum.disModel.n)}`);
      console.log(`  인기픽   연승 ${pct(cum.disFav.show, cum.disFav.n)} / 단승 ${pct(cum.disFav.win, cum.disFav.n)}`);
      const edge =
        ((cum.disModel.show / cum.disModel.n) - (cum.disFav.show / cum.disFav.n)) * 100;
      console.log(
        `  → 엇갈릴 때 연승 우위: ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%p  ` +
        `${edge >= 0 ? '(모델이 시장보다 나음)' : '(모델이 시장보다 못함)'}`
      );
    }

    console.log('-'.repeat(80));
    console.log('[상위3 묶음] 상위 3마리가 실제 top3를 평균 몇 마리 잡나 (0~3)');
    if (cum.setN > 0) {
      const m = cum.setModelSum / cum.setN;
      const f = cum.setMktSum / cum.setN;
      const d = m - f;
      console.log(`  모델 ${m.toFixed(2)}마리  /  시장 ${f.toFixed(2)}마리  (n=${cum.setN})`);
      console.log(
        `  → 묶음 우위: ${d >= 0 ? '+' : ''}${d.toFixed(2)}마리  ` +
        `${d >= 0 ? '(모델이 시장보다 잘 잡음)' : '(시장이 더 잘 잡음)'}`
      );
    }

    console.log('-'.repeat(80));
    if (cumModel.n > 0 && cumV1.n > 0) {
      const diff =
        ((cumModel.show / cumModel.n) - (cumV1.show / cumV1.n)) * 100;
      const p = cumV1.show / cumV1.n;
      const se = Math.sqrt((p * (1 - p)) / cumModel.n) * 100 * 1.96;
      console.log(
        `[노이즈 마진] 모델연승 − v1연승 = ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p  ` +
        `|  대략 95% 표본오차 ±${se.toFixed(1)}%p  (v1 n=${cumV1.n})`
      );
      console.log(
        Math.abs(diff) > se
          ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
          : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)'
      );
    }

    console.log('\n' + '='.repeat(80));
    const modelBeatsMkt =
      cumModel.n > 0 && cumMkt.n > 0
        ? cumModel.show / cumModel.n > cumMkt.show / cumMkt.n
        : null;
    const modelBeatsV1 =
      cumModel.n > 0 && cumV1.n > 0
        ? cumModel.show / cumModel.n > cumV1.show / cumV1.n
        : null;
    const gbdtBeatsLogistic =
      cumGbdt.n > 0 && cumModel.n > 0
        ? cumGbdt.show / cumGbdt.n > cumModel.show / cumModel.n
        : null;
    const gbdtBeatsV1 =
      cumGbdt.n > 0 && cumV1.n > 0
        ? cumGbdt.show / cumGbdt.n > cumV1.show / cumV1.n
        : null;
    const gbdtBeatsMkt =
      cumGbdt.n > 0 && cumMkt.n > 0
        ? cumGbdt.show / cumGbdt.n > cumMkt.show / cumMkt.n
        : null;
    const gbdtVsLogisticDelta =
      cumGbdt.n > 0 && cumModel.n > 0
        ? ((cumGbdt.show / cumGbdt.n) - (cumModel.show / cumModel.n)) * 100
        : null;

    console.log('【최종 판정 — 로지스틱 (walk-forward 누적)】');
    console.log(
      `  모델 연승 vs v1  : ${modelBeatsV1 == null ? 'N/A' : modelBeatsV1 ? '✓ 모델 > v1' : '✗ 모델 ≤ v1'}`
    );
    console.log(
      `  모델 연승 vs 시장: ${modelBeatsMkt == null ? 'N/A' : modelBeatsMkt ? '✓ 모델 > 시장' : '✗ 모델 ≤ 시장'}`
    );
    console.log('');

    console.log('【최종 판정 — GBDT (walk-forward 누적)】');
    console.log(
      `  GBDT 연승 vs 로지스틱: ${gbdtBeatsLogistic == null ? 'N/A' : gbdtBeatsLogistic ? '✓' : '✗'}` +
      (gbdtVsLogisticDelta != null
        ? `  Δ${gbdtVsLogisticDelta >= 0 ? '+' : ''}${gbdtVsLogisticDelta.toFixed(1)}%p`
        : '')
    );
    console.log(
      `  GBDT 연승 vs v1      : ${gbdtBeatsV1 == null ? 'N/A' : gbdtBeatsV1 ? '✓' : '✗'}`
    );
    console.log(
      `  GBDT 연승 vs 시장    : ${gbdtBeatsMkt == null ? 'N/A' : gbdtBeatsMkt ? '✓' : '✗'}`
    );

    if (gbdtVsLogisticDelta != null && cumModel.n > 0) {
      const pBase = cumModel.show / cumModel.n;
      const se = Math.sqrt((pBase * (1 - pBase)) / cumModel.n) * 100 * 1.96;
      console.log(
        `  [노이즈 마진] GBDT연승 − 로지스틱연승 = ${gbdtVsLogisticDelta >= 0 ? '+' : ''}${gbdtVsLogisticDelta.toFixed(1)}%p` +
        `  |  대략 95% 표본오차 ±${se.toFixed(1)}%p`
      );
      console.log(
        '  ' + (Math.abs(gbdtVsLogisticDelta) > se
          ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
          : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)')
      );
    }

    console.log('  (사람이 최종 판단 — 노이즈 마진 확인 필수)\n');
  }
}

main().catch((e: unknown) => {
  console.error('실험 실패:', e);
  process.exit(1);
});
