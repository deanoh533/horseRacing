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

// ── 향후 Task 3~5에서 채워질 함수 슬롯 ────────────────────────────

// buildMatrix(races): 피처 행렬 + 라벨 배열 생성
// trainModels(trainRaces): Logistic / GBDT / PL 동시 학습
// evalModels(testRaces, models): 적중률·ROI 비교
// main(): collectRaces(TRAIN) → trainModels → collectRaces(TEST) → evalModels → 결과 출력

// fitGBDT, predictGBDT, fitPL, predictPL 은 위 함수들에서 사용됨
void fitGBDT;
void predictGBDT;
void fitPL;
void predictPL;
void getLocalDb;
