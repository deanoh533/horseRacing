/**
 * Multi-Model Benchmark
 * TRAIN: 2024-01-01 ~ 2025-12-31  TEST: 2026-01-01 ~ 현재
 * 사용: npm run benchmark
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { gatherRaceInputs } from '../src/engine/scorePredictor.js';
import { ScoreEngine } from '../src/engine/index.js';
import { buildFeatures } from '../src/engine/features/buildFeatures.js';
import { featureToItem } from '../src/engine/features/featureItemMap.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { fitGBDT, predictGBDT } from '../src/engine/models/gbdt.js';
import { fitPL, predictPL } from '../src/engine/models/plackettLuce.js';
// computeOptimalWeights은 Task 5에서 추가 (weightLearner가 SupabaseClient에 의존)
import type { ReadClient } from '../src/db/localDb.js';
import type { Feature } from '../src/engine/features/types.js';

// ── 타입 정의 ──────────────────────────────────────────────────────

export interface RaceRecord {
  raceDate: number;
  meet: number;
  rcNo: number;
  horses: HorseRecord[];
}

export interface HorseRecord {
  hrName: string;
  pthrNo: number;
  ord: number;
  winOdds: number | null;
  rawScores: Record<string, number>;
  features: Feature[];
}

// ── collectRaces ───────────────────────────────────────────────────

/**
 * 지정 기간의 확정 경주(ord 있는 말 ≥3두) 전체를 수집한다.
 * @param db     ReadClient (localDb 또는 Supabase 어댑터)
 * @param fromDate YYYYMMDD 형식 숫자 (포함)
 * @param toDate   YYYYMMDD 형식 숫자 (포함)
 */
export async function collectRaces(
  db: ReadClient,
  fromDate: number,
  toDate: number
): Promise<RaceRecord[]> {
  const { data: raceList, error } = await db
    .from('races')
    .select('race_date, meet, rc_no')
    .gte('race_date', fromDate)
    .lte('race_date', toDate)
    .order('race_date')
    .order('meet')
    .order('rc_no');
  if (error) throw error;
  if (!raceList || raceList.length === 0) return [];

  const races: RaceRecord[] = [];
  const engine = new ScoreEngine({});

  for (const r of raceList as { race_date: number; meet: number; rc_no: number }[]) {
    const rows = await gatherRaceInputs(db, r.race_date, r.meet, r.rc_no);
    if (rows.length === 0) continue;

    // 확정 경주만: ord가 있고 취소마(ord>=50)가 아닌 말 3두 이상
    const withOrd = rows.filter((row) => row.ord !== null && row.ord < 50);
    if (withOrd.length < 3) continue;

    // win_odds 조회
    const { data: entries } = await db
      .from('race_entries')
      .select('pthr_no, win_odds')
      .eq('race_date', r.race_date)
      .eq('meet', r.meet)
      .eq('rc_no', r.rc_no);
    const oddsMap = new Map<number, number | null>();
    for (const e of (entries ?? []) as { pthr_no: number; win_odds: number | null }[]) {
      oddsMap.set(e.pthr_no, e.win_odds);
    }

    const horses: HorseRecord[] = withOrd.map((row) => {
      const scored = engine.calculateScores(row.input);

      // 항목별 rawScore 추출 (Record<ItemId, ItemScore> → Record<string, number>)
      const rawScores: Record<string, number> = {};
      for (const [id, item] of Object.entries(scored.items)) {
        rawScores[id] = item.rawScore;
      }

      return {
        hrName: row.hr_name,
        pthrNo: row.pthr_no,
        ord: row.ord as number,  // withOrd 필터로 non-null 보장
        winOdds: oddsMap.get(row.pthr_no) ?? null,
        rawScores,
        features: buildFeatures(row.input),
      };
    });

    races.push({ raceDate: r.race_date, meet: r.meet, rcNo: r.rc_no, horses });
  }

  return races;
}

// ── 게이트 A: 피처 상관계수 ───────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return Math.sqrt(dx * dy) === 0 ? 0 : num / Math.sqrt(dx * dy);
}

export interface GateAWarning {
  newFeat: string;
  existingFeat: string;
  r: number;
}

export function runGateA(races: RaceRecord[]): GateAWarning[] {
  // 모든 피처 이름 수집
  const allFeats = new Set<string>();
  for (const race of races)
    for (const h of race.horses)
      for (const f of h.features) allFeats.add(f.name);

  const featNames = [...allFeats].sort();

  // 피처별 값 벡터 (말 단위)
  const vectors = new Map<string, number[]>();
  for (const name of featNames) vectors.set(name, []);
  for (const race of races)
    for (const h of race.horses) {
      const present = new Map(h.features.map((f) => [f.name, f.value]));
      for (const name of featNames)
        vectors.get(name)!.push(present.get(name) ?? 0);
    }

  const warnings: GateAWarning[] = [];
  const THRESHOLD = 0.5;
  const names = featNames.filter((n) => !n.endsWith('__missing'));

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!, b = names[j]!;
      // 같은 ScoreItem끼리는 비교 생략
      if (featureToItem(a) === featureToItem(b)) continue;
      const r = pearson(vectors.get(a)!, vectors.get(b)!);
      if (Number.isFinite(r) && Math.abs(r) > THRESHOLD) {
        warnings.push({ newFeat: a, existingFeat: b, r });
      }
    }
  }
  return warnings;
}

export function printGateA(warnings: GateAWarning[]): void {
  if (warnings.length === 0) {
    console.log('  ✅ 게이트 A: 이상 없음');
    return;
  }
  console.log(`  ⚠️  게이트 A: ${warnings.length}개 상관 경고 (|r|>0.5)`);
  for (const w of warnings.slice(0, 10)) {
    console.log(
      `     [${w.newFeat}] ↔ [${w.existingFeat}] r=${w.r.toFixed(2)}`
      + `\n       → 상관이 높아도 독립 정보 가능. 포함 여부는 게이트 B 판단.`
    );
  }
  if (warnings.length > 10) console.log(`     ... 외 ${warnings.length - 10}개`);
}

// ── 게이트 B: 연승률 개선량 ───────────────────────────────────────

const GATE_B_HOLDOUT_START = 20251001;
const GATE_B_HOLDOUT_END   = 20251231;

export interface GateBResult {
  itemId: string;
  include: boolean;
  delta: number;
  withRate: number;
  withoutRate: number;
}

export function runGateB(races: RaceRecord[]): GateBResult[] {
  const gateTrain = races.filter((r) => r.raceDate < GATE_B_HOLDOUT_START);
  const gateHoldout = races.filter(
    (r) => r.raceDate >= GATE_B_HOLDOUT_START && r.raceDate <= GATE_B_HOLDOUT_END
  );
  if (gateHoldout.length < 50) {
    console.warn('  ⚠️  게이트 B holdout 경주 수 부족 (<50). 결과 신뢰도 낮음.');
  }

  // 모든 ScoreItem ID 목록
  const itemIds = [...new Set(
    races.flatMap((r) => r.horses.flatMap((h) =>
      h.features.map((f) => featureToItem(f.name))
    ))
  )].filter((id) => id !== 'context' && id !== '').sort();

  // 전체 피처 스키마
  const allFeatures = buildSchema(gateTrain.flatMap((r) => r.horses.map((h) => h.features)));

  // 학습 행렬
  const trainX = gateTrain.flatMap((r) =>
    r.horses.map((h) => toVector(h.features, allFeatures))
  );
  const trainY = gateTrain.flatMap((r) =>
    r.horses.map((h) => (h.ord <= 3 ? 1 : 0))
  );

  // holdout 연승률 헬퍼
  function placeRate(
    model: ReturnType<typeof fitLogistic>,
    holdout: RaceRecord[],
    schema: string[]
  ): number {
    let hit = 0, n = 0;
    for (const race of holdout) {
      const scored = race.horses.map((h) => ({
        h,
        score: predictLogit(model, toVector(h.features, schema)),
      }));
      const top = scored.sort((a, b) => b.score - a.score)[0];
      if (!top) continue;
      n++;
      if (top.h.ord <= 3) hit++;
    }
    return n ? hit / n : 0;
  }

  // 기준선: 전체 피처 모델
  const modelAll = fitLogistic(trainX, trainY, allFeatures);
  const baseRate = placeRate(modelAll, gateHoldout, allFeatures);

  const results: GateBResult[] = [];
  for (const itemId of itemIds) {
    const itemFeats = allFeatures.filter((n) => featureToItem(n) === itemId);
    if (itemFeats.length === 0) {
      results.push({ itemId, include: false, delta: 0, withRate: baseRate, withoutRate: baseRate });
      continue;
    }

    // 해당 항목 제거한 스키마
    const reducedFeatures = allFeatures.filter((n) => featureToItem(n) !== itemId);

    const withoutX = gateTrain.flatMap((r) =>
      r.horses.map((h) => toVector(h.features, reducedFeatures))
    );
    const modelWithout = fitLogistic(withoutX, trainY, reducedFeatures);
    const withoutRate = placeRate(modelWithout, gateHoldout, reducedFeatures);
    const delta = baseRate - withoutRate;

    results.push({ itemId, include: delta > 0, delta, withRate: baseRate, withoutRate });
  }
  return results;
}

export function printGateB(results: GateBResult[]): void {
  console.log('\n=== 항목 포함 현황 ===\n');
  console.log('항목                   │ Logistic/GBDT/PL │ 게이트B 개선량');
  console.log('─'.repeat(60));
  for (const r of [...results].sort((a, b) => b.delta - a.delta)) {
    const mark = r.include ? '✅ 포함  ' : '⚠️  제외  ';
    const sign = r.delta >= 0 ? '+' : '';
    console.log(
      `${r.itemId.padEnd(23)}│ ${mark.padEnd(16)}│ ${sign}${(r.delta * 100).toFixed(1)}%p`
    );
  }
}

// ── Spearman weights 학습 ─────────────────────────────────────────

function spearmanRho(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const rank = (arr: number[]) => {
    const sorted = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length).fill(0) as number[];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1]![0] === sorted[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[sorted[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx, b = ry[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return Math.sqrt(dx * dy) === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function learnSpearman(races: RaceRecord[]): Record<string, number> {
  // 모든 ScoreItem ID 수집
  const allItemIds = new Set<string>();
  for (const race of races)
    for (const h of race.horses)
      for (const id of Object.keys(h.rawScores)) allItemIds.add(id);

  const sumRho: Record<string, number> = {};
  const cnt: Record<string, number> = {};

  for (const race of races) {
    if (race.horses.length < 3) continue;
    for (const itemId of allItemIds) {
      const xs = race.horses.map((h) => h.rawScores[itemId] ?? 0);
      const ys = race.horses.map((h) => -h.ord); // 낮은 ord = 좋음
      const rho = spearmanRho(xs, ys);
      if (Number.isFinite(rho)) {
        sumRho[itemId] = (sumRho[itemId] ?? 0) + rho;
        cnt[itemId] = (cnt[itemId] ?? 0) + 1;
      }
    }
  }

  // 평균 ρ → ReLU(ρ) 정규화 (양의 상관만, 합=1)
  const weights: Record<string, number> = {};
  let total = 0;
  for (const id of allItemIds) {
    const avgRho = cnt[id] ? sumRho[id]! / cnt[id]! : 0;
    weights[id] = Math.max(0, avgRho);
    total += weights[id];
  }
  if (total > 0) for (const id of allItemIds) weights[id] /= total;
  return weights;
}

// ── 9개 모델 학습 ─────────────────────────────────────────────────

export interface TrainedModels {
  spearmanWeights: Record<string, number>;
  logisticTop1: ReturnType<typeof fitLogistic>;
  logisticTop2: ReturnType<typeof fitLogistic>;
  logisticTop3: ReturnType<typeof fitLogistic>;
  gbdtTop1: ReturnType<typeof fitGBDT>;
  gbdtTop2: ReturnType<typeof fitGBDT>;
  gbdtTop3: ReturnType<typeof fitGBDT>;
  pl: ReturnType<typeof fitPL>;
  featureSchema: string[];
}

export function trainAllModels(
  races: RaceRecord[],
  approvedItems: Set<string>
): TrainedModels {
  console.log('\n학습 중...');

  const allRaceFeatures = races.flatMap((r) => r.horses.map((h) => h.features));
  const fullSchema = buildSchema(allRaceFeatures);
  const featureSchema = fullSchema.filter(
    (name) => approvedItems.has(featureToItem(name)) && !name.endsWith('__missing')
  );

  const X = races.flatMap((r) =>
    r.horses.map((h) => toVector(h.features, featureSchema))
  );
  const yTop1 = races.flatMap((r) => r.horses.map((h) => (h.ord === 1 ? 1 : 0)));
  const yTop2 = races.flatMap((r) => r.horses.map((h) => (h.ord <= 2 ? 1 : 0)));
  const yTop3 = races.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));

  const plRaces = races.map((r) => ({
    horses: r.horses.map((h) => ({ x: toVector(h.features, featureSchema), ord: h.ord })),
  }));

  return {
    spearmanWeights: learnSpearman(races),
    logisticTop1: fitLogistic(X, yTop1, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    logisticTop2: fitLogistic(X, yTop2, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    logisticTop3: fitLogistic(X, yTop3, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    gbdtTop1: fitGBDT(X, yTop1, featureSchema),
    gbdtTop2: fitGBDT(X, yTop2, featureSchema),
    gbdtTop3: fitGBDT(X, yTop3, featureSchema),
    pl: fitPL(plRaces, featureSchema),
    featureSchema,
  };
}

// ── 평가 ──────────────────────────────────────────────────────────

interface RaceResult {
  win: boolean;
  place: boolean;
  quinella: boolean;
}

interface MethodTally {
  win: number; place: number; quinella: number; n: number;
}

const emptyTally = (): MethodTally => ({ win: 0, place: 0, quinella: 0, n: 0 });

function quarterOf(raceDate: number): string {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

const METHOD_KEYS = [
  'market', 'spearman',
  'logisticTop1', 'logisticTop2', 'logisticTop3',
  'gbdtTop1', 'gbdtTop2', 'gbdtTop3', 'pl',
] as const;

type MethodKey = typeof METHOD_KEYS[number];

function evaluateRace(
  race: RaceRecord,
  models: TrainedModels
): Record<MethodKey, RaceResult> {
  const { horses } = race;
  const schema = models.featureSchema;

  const scoreHorses = (scorer: (h: HorseRecord) => number): RaceResult => {
    const sorted = [...horses].sort((a, b) => scorer(b) - scorer(a));
    const top1 = sorted[0];
    const top2Nos = new Set([sorted[0]?.pthrNo, sorted[1]?.pthrNo]);
    const win = top1 ? top1.ord === 1 : false;
    const place = top1 ? top1.ord <= 3 : false;
    const actual12 = horses.filter((h) => h.ord <= 2).map((h) => h.pthrNo);
    const quinella = actual12.length === 2 && actual12.every((p) => top2Nos.has(p));
    return { win, place, quinella };
  };

  return {
    market: (() => {
      const valid = horses.filter((h) => h.winOdds != null && h.winOdds > 0);
      if (valid.length === 0) return { win: false, place: false, quinella: false };
      return scoreHorses((h) => (h.winOdds != null && h.winOdds > 0) ? -h.winOdds! : -Infinity);
    })(),
    spearman: scoreHorses((h) => {
      let s = 0;
      for (const [id, w] of Object.entries(models.spearmanWeights))
        s += (h.rawScores[id] ?? 0) * w;
      return s;
    }),
    logisticTop1: scoreHorses((h) => predictLogit(models.logisticTop1, toVector(h.features, schema))),
    logisticTop2: scoreHorses((h) => predictLogit(models.logisticTop2, toVector(h.features, schema))),
    logisticTop3: scoreHorses((h) => predictLogit(models.logisticTop3, toVector(h.features, schema))),
    gbdtTop1: scoreHorses((h) => predictGBDT(models.gbdtTop1, toVector(h.features, schema))),
    gbdtTop2: scoreHorses((h) => predictGBDT(models.gbdtTop2, toVector(h.features, schema))),
    gbdtTop3: scoreHorses((h) => predictGBDT(models.gbdtTop3, toVector(h.features, schema))),
    pl:        scoreHorses((h) => predictPL(models.pl, toVector(h.features, schema))),
  };
}

function evaluate(
  races: RaceRecord[],
  models: TrainedModels
): { overall: Record<MethodKey, MethodTally>; byQuarter: Map<string, Record<MethodKey, MethodTally>> } {
  const overall = Object.fromEntries(METHOD_KEYS.map((k) => [k, emptyTally()])) as Record<MethodKey, MethodTally>;
  const byQuarter = new Map<string, Record<MethodKey, MethodTally>>();

  for (const race of races) {
    const q = quarterOf(race.raceDate);
    if (!byQuarter.has(q)) {
      byQuarter.set(q, Object.fromEntries(METHOD_KEYS.map((k) => [k, emptyTally()])) as Record<MethodKey, MethodTally>);
    }
    const results = evaluateRace(race, models);
    for (const k of METHOD_KEYS) {
      const res = results[k];
      const t = overall[k];
      t.n++; if (res.win) t.win++; if (res.place) t.place++; if (res.quinella) t.quinella++;
      const qt = byQuarter.get(q)![k];
      qt.n++; if (res.win) qt.win++; if (res.place) qt.place++; if (res.quinella) qt.quinella++;
    }
  }
  return { overall, byQuarter };
}

// ── 리포트 출력 ───────────────────────────────────────────────────

const METHOD_LABELS: Record<MethodKey, string> = {
  market:       '시장 배당',
  spearman:     'Spearman',
  logisticTop1: 'Logistic (top1)',
  logisticTop2: 'Logistic (top2)',
  logisticTop3: 'Logistic (top3)',
  gbdtTop1:     'GBDT     (top1)',
  gbdtTop2:     'GBDT     (top2)',
  gbdtTop3:     'GBDT     (top3)',
  pl:           'Plackett-Luce',
};

function pct(n: number, d: number): string { return d ? `${(n / d * 100).toFixed(1)}%` : '-'; }

function printReport(
  evalResult: ReturnType<typeof evaluate>,
  gateBResults: GateBResult[]
): void {
  const { overall, byQuarter } = evalResult;
  const quarters = [...byQuarter.keys()].sort();

  // 분기별 연승률
  console.log('\n=== 연승률 (1순위 예측마가 3착이내) ===\n');
  const qHeader = '방법'.padEnd(22) + '│' + quarters.map((q) => ` ${q}  `).join('│') + '│ 전체';
  console.log(qHeader);
  console.log('─'.repeat(qHeader.length));
  for (const k of METHOD_KEYS) {
    const row = METHOD_LABELS[k].padEnd(22) + '│'
      + quarters.map((q) => { const t = byQuarter.get(q)![k]; return ` ${pct(t.place, t.n).padStart(6)} `; }).join('│')
      + '│ ' + pct(overall[k].place, overall[k].n);
    console.log(row);
  }

  // 전체 요약
  console.log('\n=== 전체 요약 (2026년) ===\n');
  console.log('방법'.padEnd(22) + '│ 단승율 │ 연승율 │ 복승율 │ n경주');
  console.log('─'.repeat(65));
  for (const k of METHOD_KEYS) {
    const t = overall[k];
    console.log(
      METHOD_LABELS[k].padEnd(22) + '│'
      + ` ${pct(t.win, t.n).padStart(6)} │`
      + ` ${pct(t.place, t.n).padStart(6)} │`
      + ` ${pct(t.quinella, t.n).padStart(6)} │`
      + ` ${String(t.n).padStart(5)}`
    );
  }

  // 게이트 B 요약 (상단 참고용)
  console.log('\n=== 항목 포함 현황 (게이트 B 결과) ===');
  printGateB(gateBResults);
}

// ── main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const TRAIN_FROM = 20240101, TRAIN_TO = 20251231;
  const TEST_FROM  = 20260101, TEST_TO   = 99991231;

  const db = await getLocalDb();

  console.log('📊 Multi-Model Benchmark 시작\n');
  console.log(`데이터 수집 중 (${TRAIN_FROM}~${TEST_TO})...`);
  const allRaces = await collectRaces(db, TRAIN_FROM, TEST_TO);
  const trainRaces = allRaces.filter((r) => r.raceDate <= TRAIN_TO);
  const testRaces  = allRaces.filter((r) => r.raceDate >= TEST_FROM);
  console.log(`  TRAIN: ${trainRaces.length}경주 / TEST: ${testRaces.length}경주`);

  console.log('\n[게이트 A] 상관계수 점검...');
  const gateAWarnings = runGateA(trainRaces);
  printGateA(gateAWarnings);

  console.log('\n[게이트 B] 연승률 개선량 계산 중...');
  const gateBResults = runGateB(trainRaces);

  const approvedItems = new Set(gateBResults.filter((r) => r.include).map((r) => r.itemId));
  console.log(`  → ${approvedItems.size}개 항목 승인됨`);

  const models = trainAllModels(trainRaces, approvedItems);
  console.log('  ✅ 학습 완료');

  console.log('\n[테스트] 2026년 평가 중...');
  const evalResult = evaluate(testRaces, models);

  printReport(evalResult, gateBResults);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
