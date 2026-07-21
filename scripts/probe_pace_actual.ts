/**
 * 페이스 예측 vs 실측 교차검증 probe — /picks·출마정보 페이스 배지(F-001)가
 * 실제 경주 전개와 맞물리는지 확인. 로컬 미러 전용(egress 0), 사후 데이터.
 *
 * 예측 페이스: 출전마 as-of 성향(그 경주 이전 성적만)으로 선두권 마릿수 → HOT/NORMAL/SLOW.
 *   규칙 SSOT = src/engine/scorePredictor.ts computePaceType (아래 paceTypeFromStyles로 4줄 복제).
 *   as-of 성향 = computeAsOfHorseStats(순수함수) 그대로 재사용 → 산식 갈림 없음.
 * 실측 페이스: 그 경주 avg_s1f − pacePar → labelPastRacePace → HOT/NORMAL/SLOW (속도 기반).
 *
 * 출력: ① 커버리지 ② 3×3 혼동행렬(예측×실측) + 행% ③ 일치율 vs 독립기대
 *       ④ 예측 타입별 실측 delta 평균(방향성 sanity).
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { buildPaceParMap, paceParKey, type PaceParSourceRow } from '../src/engine/pacePar.js';
import { labelPastRacePace, type PaceBucket } from '../src/engine/features/paceForm.js';
import { computeAsOfHorseStats, type AsOfPastRace } from '../src/engine/asOfHorseStats.js';

const CUTOFF = 99991231; // 실측 라벨용 all-time par (측정치이지 예측이 아니므로 전 기간)
const HISTORY = 60;      // 말별 as-of 윈도우 — production fetchAsOfHorseStats .limit(60) 미러
const PAGE = 5000;
const BUCKETS: PaceBucket[] = ['HOT', 'NORMAL', 'SLOW'];

/** SSOT: src/engine/scorePredictor.ts computePaceType — 규칙 동일 유지(선두권=avg≤0.35 & 자유마 제외). */
function paceTypeFromStyles(
  styles: Array<{ avg: number | null; std: number | null }>
): { type: PaceBucket; front: number; known: number; total: number } {
  let front = 0;
  let known = 0;
  for (const s of styles) {
    if (s.avg == null) continue;
    known++;
    const isFree = s.std != null && s.std >= 0.35;
    if (!isFree && s.avg <= 0.35) front++;
  }
  const type: PaceBucket = front >= 3 ? 'HOT' : front <= 1 ? 'SLOW' : 'NORMAL';
  return { type, front, known, total: styles.length };
}

async function main() {
  const sb = await getLocalDb();

  // ① race_sectional_stats: par 소스 + 실측 라벨 + fieldSize(경주별 horses)
  const parSrc: PaceParSourceRow[] = [];
  const sect = new Map<string, { date: number; meet: number; rcNo: number; dist: number; avgS1f: number; horses: number }>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f, horses')
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_no: number; rc_dist: number | null; avg_s1f: number | null; horses: number }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(Number(r.avg_s1f) > 0)) continue;
      const key = `${r.race_date}-${r.meet}-${r.rc_no}`;
      parSrc.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
      sect.set(key, { date: r.race_date, meet: r.meet, rcNo: r.rc_no, dist: r.rc_dist, avgS1f: Number(r.avg_s1f), horses: Number(r.horses) });
    }
    if (data.length < PAGE) break;
  }
  const par = buildPaceParMap(parSrc, CUTOFF);

  // 실측 라벨 + delta per race
  const actual = new Map<string, PaceBucket>();
  const deltaByRace = new Map<string, number>();
  for (const [key, s] of sect) {
    const p = par.get(paceParKey(s.meet, s.dist));
    if (p == null) continue;
    deltaByRace.set(key, s.avgS1f - p);
    const lab = labelPastRacePace(s.avgS1f, p);
    if (lab) actual.set(key, lab);
  }

  // ② race_entries 전량(ord 있음) → 말별 시간순. s1fOrd는 서울=sj / 그 외=bu.
  type Entry = { hr: string; date: number; meet: number; rcNo: number; ord: number; s1f: number | null };
  const byHorse = new Map<string, Entry[]>();
  const entrantsByRace = new Map<string, string[]>();
  let rowCount = 0;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('hr_name, race_date, meet, rc_no, ord, sj_s1f_ord, bu_s1f_ord')
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('hr_name')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ hr_name: string; race_date: number; meet: number; rc_no: number; ord: number; sj_s1f_ord: number | null; bu_s1f_ord: number | null }>) {
      const e: Entry = {
        hr: r.hr_name, date: r.race_date, meet: r.meet, rcNo: r.rc_no, ord: r.ord,
        s1f: (r.meet === 1 ? r.sj_s1f_ord : r.bu_s1f_ord) ?? null,
      };
      const arr = byHorse.get(e.hr); if (arr) arr.push(e); else byHorse.set(e.hr, [e]);
      const key = `${e.date}-${e.meet}-${e.rcNo}`;
      const el = entrantsByRace.get(key); if (el) el.push(e.hr); else entrantsByRace.set(key, [e.hr]);
      rowCount++;
    }
    if (data.length < PAGE) break;
  }

  // ③ as-of {avg,std} per (raceKey, hr) — 말별 시간순으로 현재 경주 직전까지만 집계(누수 없음)
  const asOf = new Map<string, { avg: number | null; std: number | null }>();
  for (const [hr, races] of byHorse) {
    races.sort((a, b) => a.date - b.date || a.meet - b.meet || a.rcNo - b.rcNo);
    let pastArr: AsOfPastRace[] = [];
    for (const e of races) {
      const stats = computeAsOfHorseStats(pastArr, null);
      asOf.set(`${e.date}-${e.meet}-${e.rcNo}|${hr}`, { avg: stats.avgPositionRatio, std: stats.stddevPositionRatio });
      const fs = sect.get(`${e.date}-${e.meet}-${e.rcNo}`)?.horses ?? 0;
      pastArr.push({ s1fOrd: e.s1f, ord: e.ord, fieldSize: fs, distCategory: null, paceLabel: null });
      if (pastArr.length > HISTORY) pastArr = pastArr.slice(-HISTORY);
    }
  }

  // ④ 경주별 예측 → 혼동행렬. F-001 표시 게이트(known ≥ total/2)로 "실제 배지 뜨는 경주"만 집계.
  const mat = { gated: emptyMat(), all: emptyMat() };
  const deltaSumByPred: Record<PaceBucket, { sum: number; n: number }> = {
    HOT: { sum: 0, n: 0 }, NORMAL: { sum: 0, n: 0 }, SLOW: { sum: 0, n: 0 },
  };
  let racesWithActual = 0, racesShown = 0;
  for (const [key, entrants] of entrantsByRace) {
    const act = actual.get(key);
    if (act == null) continue;
    racesWithActual++;
    const styles = entrants.map((hr) => asOf.get(`${key}|${hr}`) ?? { avg: null, std: null });
    const pred = paceTypeFromStyles(styles);
    mat.all[pred.type][act]++;
    const d = deltaByRace.get(key);
    if (d != null) { deltaSumByPred[pred.type].sum += d; deltaSumByPred[pred.type].n++; }
    if (pred.known >= pred.total / 2) { mat.gated[pred.type][act]++; racesShown++; }
  }

  // ── 출력 ──
  console.log(`구간기록 경주: ${sect.size} · par 버킷: ${par.size} · 실측 라벨 가능: ${actual.size}`);
  console.log(`출전 엔트리(ord 있음): ${rowCount} · 말: ${byHorse.size}`);
  console.log(`실측 라벨 있는 경주 중 예측 계산됨: ${racesWithActual} · 배지 표시 조건(known≥½) 충족: ${racesShown} (${pct(racesShown, racesWithActual)})\n`);

  printMatrix('배지 표시 경주 (F-001 게이트 통과, known≥½)', mat.gated);
  printMatrix('전체 (게이트 무시 — 참고)', mat.all);

  console.log('예측 타입별 실측 delta(avg_s1f−par, 초) 평균 — 음수=초반 빠름(HOT 방향):');
  for (const b of BUCKETS) {
    const s = deltaSumByPred[b];
    console.log(`  예측 ${b.padEnd(6)}: ${s.n ? (s.sum / s.n).toFixed(3) : '  -  '}초 (n=${s.n})`);
  }
  console.log('  → 방향 정상이면 예측 HOT의 delta가 가장 음수, 예측 SLOW가 가장 양수.');
}

function emptyMat(): Record<PaceBucket, Record<PaceBucket, number>> {
  const m = {} as Record<PaceBucket, Record<PaceBucket, number>>;
  for (const p of BUCKETS) { m[p] = { HOT: 0, NORMAL: 0, SLOW: 0 }; }
  return m;
}

function printMatrix(title: string, m: Record<PaceBucket, Record<PaceBucket, number>>) {
  let total = 0, diag = 0;
  const rowSum: Record<PaceBucket, number> = { HOT: 0, NORMAL: 0, SLOW: 0 };
  const colSum: Record<PaceBucket, number> = { HOT: 0, NORMAL: 0, SLOW: 0 };
  for (const p of BUCKETS) for (const a of BUCKETS) {
    total += m[p][a]; rowSum[p] += m[p][a]; colSum[a] += m[p][a];
    if (p === a) diag += m[p][a];
  }
  console.log(`\n■ ${title}  (n=${total})`);
  if (total === 0) { console.log('  (표본 없음)\n'); return; }
  console.log('  예측\\실측   HOT       NORMAL    SLOW      | 행합  일치%(대각)');
  for (const p of BUCKETS) {
    const cells = BUCKETS.map((a) => {
      const c = m[p][a];
      return `${String(c).padStart(4)}(${pct(c, rowSum[p]).padStart(5)})`;
    });
    console.log(`  ${p.padEnd(9)} ${cells.join(' ')} | ${String(rowSum[p]).padStart(4)}  ${pct(m[p][p], rowSum[p])}`);
  }
  // 독립기대 일치율 = Σ (행합/total)·(열합/total)
  let indep = 0;
  for (const b of BUCKETS) indep += (rowSum[b] / total) * (colSum[b] / total);
  console.log(`  전체 일치율(대각/total): ${pct(diag, total)}  vs 독립기대 ${(100 * indep).toFixed(1)}%  → ${diag / total > indep ? '예측이 실측과 양(+)의 연관' : '연관 없음/음(노이즈)'}`);
  console.log('');
}

function pct(a: number, b: number): string {
  return b === 0 ? '0.0%' : `${(100 * a / b).toFixed(1)}%`;
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
