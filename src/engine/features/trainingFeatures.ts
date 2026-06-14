import type { Feature } from './types.js';
import type { TrainingSession } from '../index.js';
import { mean, slope } from './mathUtils.js';

const ROLE_CODES = new Set(['조', '관', '생']); // 조교사/주로조교/교육생 = 기수 아님

/** pr_gubun이 역할코드(조/관/생)가 아니면 기수(이름/이름(트))가 탄 것으로 간주. ⚠️ KRA 매뉴얼로 확정 예정. */
export function isJockeyRidden(prGubun: string | null | undefined): boolean {
  if (prGubun == null || prGubun === '') return false;
  return !ROLE_CODES.has(prGubun);
}

function ymdToDate(ymd: number): Date {
  return new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100));
}
function daysBetweenYmd(a: number, b: number): number {
  return Math.round((ymdToDate(b).getTime() - ymdToDate(a).getTime()) / 86400000);
}
function subtractDaysYmd(ymd: number, n: number): number {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() - n);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function weeklyCountSlope(rows: TrainingSession[], windowStart: number, raceDate: number): number {
  const totalDays = Math.max(1, daysBetweenYmd(windowStart, raceDate));
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const buckets = new Array(weeks).fill(0);
  for (const r of rows) {
    const off = daysBetweenYmd(windowStart, r.trainDate);
    buckets[Math.min(weeks - 1, Math.max(0, Math.floor(off / 7)))]++;
  }
  return slope(buckets);
}

export interface TrainingFeatureContext {
  trainingHistory: TrainingSession[]; // as-of (train_date < raceDate), 순서 무관
  prevRaceDate: number | null;        // 직전 경주일 (신마 null)
  raceDate: number;
  fallbackDays?: number;              // 신마용 윈도우 길이 (기본 90)
}

/** prep 사이클 윈도우 [windowStart, raceDate) 기준 조교 raw 피처. 가치판단 없음 — 모델이 학습. */
export function trainingFeatures(ctx: TrainingFeatureContext): Feature[] {
  const { trainingHistory, prevRaceDate, raceDate } = ctx;
  const fallbackDays = ctx.fallbackDays ?? 90;
  const f: Feature[] = [];
  const add = (name: string, value: number) => f.push({ name, value });

  const isFallback = prevRaceDate == null;
  const windowStart = isFallback ? subtractDaysYmd(raceDate, fallbackDays) : prevRaceDate;
  add('train_window_is_fallback', isFallback ? 1 : 0);

  const rows = trainingHistory
    .filter((t) => t.trainDate >= windowStart && t.trainDate < raceDate)
    .sort((a, b) => a.trainDate - b.trainDate); // oldest→recent

  add('train_has_data', rows.length > 0 ? 1 : 0);
  if (rows.length === 0) return f;

  const last = rows[rows.length - 1]!;

  // ① 최근성·간격
  add('train_days_since_last', daysBetweenYmd(last.trainDate, raceDate));
  add('train_count', rows.length);
  const prepDays = Math.max(1, daysBetweenYmd(windowStart, raceDate));
  add('train_count_per_week', rows.length / (prepDays / 7));

  // ③ 기승자 격
  const jockeyRidden = rows.filter((r) => isJockeyRidden(r.prGubun)).length;
  add('train_jockey_ridden_ratio', jockeyRidden / rows.length);
  add('train_last_rider_is_jockey', isJockeyRidden(last.prGubun) ? 1 : 0);

  // ② 강도 (⚠️ trTerm·run 의미 미확정 — 게이트로 검증)
  const terms = rows.map((r) => r.trTerm).filter((x): x is number => x != null);
  if (terms.length > 0) {
    add('train_term_mean', mean(terms));
    add('train_term_last', last.trTerm ?? mean(terms));
    add('train_term_slope', slope(rows.map((r) => r.trTerm ?? 0)));
  }
  add('train_run_cnt_mean', mean(rows.map((r) => (r.run1Cnt ?? 0) + (r.run2Cnt ?? 0))));

  // ④ 빈도 추세
  add('train_freq_slope', weeklyCountSlope(rows, windowStart, raceDate));

  return f;
}
