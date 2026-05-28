/**
 * Weight Learner
 *
 * Spearman 순위 상관계수로 항목별 예측력 측정 → 가중치 자동 조정
 *
 * 흐름:
 *   1. learnFromPredictions(periodStart, periodEnd)
 *      → 해당 기간 predictions 가져와서 항목별 Spearman ρ 계산
 *   2. computeOptimalWeights(correlations)
 *      → ρ → 가중치 비율 (음수 0 클립, 합=100 정규화)
 *   3. blend(current, optimal) — 점진 수렴 (현재 + 적정) / 2
 *   4. applyWeights(weights) → predictions의 total_score 재계산
 *   5. saveToHistory(...) → weight_history 테이블 row 추가
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ITEM_WEIGHTS, type ScoreItemId } from '../types/index.js';

export type Weights = Record<ScoreItemId, number>;
export type Correlations = Record<ScoreItemId, number>;

const ALL_ITEMS = Object.keys(ITEM_WEIGHTS) as ScoreItemId[];

/**
 * 봉인된 항목 (가중치 0 강제)
 * - (봉인 해제) 12_starting_position: 이제 chul_no(= 진짜 게이트 번호)로 계산
 */
const SEALED_ITEMS = new Set<ScoreItemId>([
  '13_age_distance_gender',  // ρ=-0.017 역방향, 영구 비활성화
  '07_track_adaptation',     // ρ=-0.304, 역상관
  '04_sectional_time',       // ρ=-0.225, 역상관
]);

/**
 * 항목별 Spearman ρ
 * - 한 경주 내에서 항목 raw_score 순위 vs 실제 ord 순위 비교
 * - 여러 경주 결과 평균
 *
 * 주의: raw_score는 "높을수록 좋은 말" / ord는 "작을수록 좋은 말"
 *        → 부호 뒤집어서 ρ를 계산 (높을수록 ord 작으면 +ρ가 되도록)
 */
export async function computeCorrelations(
  sb: SupabaseClient,
  fromDate: number,
  toDate: number
): Promise<{ correlations: Correlations; raceCount: number }> {
  type PredRow = {
    race_date: number;
    meet: number;
    rc_no: number;
    item_scores: Record<string, { rawScore?: number }> | null;
    actual_ord: number | null;
  };
  const rows: PredRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, item_scores, actual_ord')
      .gte('race_date', fromDate)
      .lte('race_date', toDate)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  // race 단위로 그룹핑
  const byRace = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }

  // 각 race마다 항목별 ρ 계산 후 평균
  const sumByItem: Record<string, number> = {};
  const countByItem: Record<string, number> = {};
  let validRaces = 0;

  for (const horses of byRace.values()) {
    const withActual = horses.filter((h) => h.actual_ord !== null && h.actual_ord <= 50);
    if (withActual.length < 3) continue; // 너무 작으면 의미 X
    validRaces++;

    for (const itemId of ALL_ITEMS) {
      const xs = withActual.map((h) => h.item_scores?.[itemId]?.rawScore ?? 0);
      const ys = withActual.map((h) => -1 * (h.actual_ord as number)); // 부호 반전: high score → high "성과"
      const rho = spearman(xs, ys);
      if (Number.isFinite(rho)) {
        sumByItem[itemId] = (sumByItem[itemId] ?? 0) + rho;
        countByItem[itemId] = (countByItem[itemId] ?? 0) + 1;
      }
    }
  }

  const correlations: Correlations = {} as Correlations;
  for (const itemId of ALL_ITEMS) {
    correlations[itemId] = countByItem[itemId] ? sumByItem[itemId]! / countByItem[itemId]! : 0;
  }

  return { correlations, raceCount: validRaces };
}

/**
 * Spearman 순위 상관계수
 */
function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function rank(values: number[]): number[] {
  const sorted = values
    .map((v, i) => [v, i] as const)
    .sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length).fill(0);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]![0] === sorted[i]![0]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based, 동순위 평균
    for (let k = i; k <= j; k++) ranks[sorted[k]![1]] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * 상관계수 → 적정 가중치
 * - 음수는 0으로 클립
 * - 합이 100이 되도록 정규화
 * - 모두 0이면 균등 분배 (1/17)
 */
export function computeOptimalWeights(correlations: Correlations): Weights {
  const positive: Record<string, number> = {};
  let sum = 0;
  for (const itemId of ALL_ITEMS) {
    // 봉인된 항목은 가중치 0
    const rho = SEALED_ITEMS.has(itemId) ? 0 : Math.max(0, correlations[itemId]);
    positive[itemId] = rho;
    sum += rho;
  }
  const optimal = {} as Weights;
  if (sum === 0) {
    const usable = ALL_ITEMS.filter((id) => !SEALED_ITEMS.has(id));
    const equal = 100 / usable.length;
    for (const itemId of ALL_ITEMS) optimal[itemId] = SEALED_ITEMS.has(itemId) ? 0 : equal;
  } else {
    for (const itemId of ALL_ITEMS) {
      optimal[itemId] = Math.round((positive[itemId] / sum) * 10000) / 100;
    }
  }
  return optimal;
}

/**
 * 점진 수렴: alpha=0.5 → (현재 + 적정) / 2, alpha=1.0 → 직접 매핑
 */
export function blendWeights(
  current: Weights,
  optimal: Weights,
  alpha = 0.5
): Weights {
  const blended = {} as Weights;
  for (const itemId of ALL_ITEMS) {
    if (SEALED_ITEMS.has(itemId)) {
      blended[itemId] = 0;
      continue;
    }
    blended[itemId] =
      Math.round(
        (current[itemId] * (1 - alpha) + optimal[itemId] * alpha) * 100
      ) / 100;
  }
  // 합이 100이 되도록 정규화 (봉인 제외)
  const s = Object.values(blended).reduce((a, b) => a + b, 0);
  if (s > 0) {
    for (const itemId of ALL_ITEMS) {
      if (SEALED_ITEMS.has(itemId)) continue;
      blended[itemId] =
        Math.round(((blended[itemId] / s) * 100) * 100) / 100;
    }
  }
  return blended;
}

/**
 * predictions의 total_score를 새 가중치로 재계산 (race 단위 batch)
 * 패턴: per-race DELETE → bulk INSERT (backfill_predictions와 동일)
 * - rawScore 그대로, weight 만 갈아끼움 → KRA 호출 없음, 매우 빠름
 */
export async function applyWeightsToPredictions(
  sb: SupabaseClient,
  weights: Weights,
  fromDate?: number,
  toDate?: number,
  onProgress?: (done: number, total: number) => void
): Promise<{ updated: number; races: number }> {
  // 모든 predictions 가져오기 (페이지네이션 — order 필수: range는 정렬 없으면 페이지 경계 중복 발생)
  type PredApplyRow = {
    race_date: number;
    meet: number;
    rc_no: number;
    hr_name: string;
    item_scores: Record<string, { rawScore?: number; itemName?: string; status?: string }> | null;
    actual_ord: number | null;
  };
  const rows: PredApplyRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    let q = sb
      .from('predictions')
      .select('race_date, meet, rc_no, hr_name, item_scores, actual_ord')
      .order('race_date')
      .order('meet')
      .order('rc_no')
      .order('hr_name')
      .range(off, off + PAGE - 1);
    if (fromDate !== undefined) q = q.gte('race_date', fromDate);
    if (toDate !== undefined) q = q.lte('race_date', toDate);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  // race 단위 그룹핑
  const byRace = new Map<string, PredApplyRow[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }

  let updated = 0;
  let raceIdx = 0;
  const totalRaces = byRace.size;

  for (const horses of byRace.values()) {
    const first = horses[0];
    // 새 total_score 계산
    const recomputed = horses.map((h) => {
      const newItems: Record<string, {
        itemId: string;
        itemName: string;
        rawScore: number;
        weight: number;
        weightedScore: number;
        status: string;
      }> = {};
      let total = 0;
      for (const itemId of ALL_ITEMS) {
        const raw = h.item_scores?.[itemId]?.rawScore ?? 0;
        const status = h.item_scores?.[itemId]?.status ?? 'implemented';
        const itemName = h.item_scores?.[itemId]?.itemName ?? itemId;
        const w = weights[itemId];
        const weighted = Math.round(raw * w * 100) / 100;
        newItems[itemId] = { itemId, itemName, rawScore: raw, weight: w, weightedScore: weighted, status };
        total += weighted;
      }
      return {
        race_date: h.race_date,
        meet: h.meet,
        rc_no: h.rc_no,
        hr_name: h.hr_name,
        item_scores: newItems,
        actual_ord: h.actual_ord,
        total_score: Math.round(total * 100) / 100,
      };
    });

    // predicted_rank 부여
    const sorted = [...recomputed].sort((a, b) => b.total_score - a.total_score);
    const rankMap = new Map<string, number>();
    sorted.forEach((s, i) => rankMap.set(s.hr_name, i + 1));
    const newRows = recomputed.map((r) => ({ ...r, predicted_rank: rankMap.get(r.hr_name)! }));

    // race 단위 delete + bulk insert
    await sb
      .from('predictions')
      .delete()
      .eq('race_date', first.race_date)
      .eq('meet', first.meet)
      .eq('rc_no', first.rc_no);
    const { error: insErr } = await sb.from('predictions').insert(newRows);
    if (insErr) throw insErr;

    updated += newRows.length;
    raceIdx++;
    if (onProgress && raceIdx % 100 === 0) onProgress(raceIdx, totalRaces);
  }

  return { updated, races: totalRaces };
}

/**
 * weight_history에 저장
 */
export async function saveWeightHistory(
  sb: SupabaseClient,
  periodStart: number,
  periodEnd: number,
  raceCount: number,
  weights: Weights,
  correlations: Correlations,
  optimalWeights: Weights
): Promise<void> {
  const fmt = (d: number) => {
    const y = Math.floor(d / 10000);
    const m = Math.floor((d % 10000) / 100);
    const day = d % 100;
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const { error } = await sb.from('weight_history').insert({
    period_start: fmt(periodStart),
    period_end: fmt(periodEnd),
    race_count: raceCount,
    weights,
    correlations,
    optimal_weights: optimalWeights,
  });
  if (error) throw error;
}

/**
 * 가장 최근 가중치 (없으면 PRD 기본값)
 */
export async function getCurrentWeights(sb: SupabaseClient): Promise<Weights> {
  const { data } = await sb
    .from('weight_history')
    .select('weights')
    .order('applied_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.weights) return data.weights as Weights;
  return { ...ITEM_WEIGHTS } as Weights;
}
