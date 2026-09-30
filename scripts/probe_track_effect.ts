/**
 * 주로 상태 → 완주시간 효과 추정 (스파이크, 읽기 전용 · 로컬 DuckDB 미러만 사용)
 *
 * 모델: log(완주시간) = 말 고정효과 + (경마장×거리) 고정효과 + 주로 상태 효과
 * 같은 말이 다른 상태에서 뛴 기록만 비교하므로 "빠른 말이 마른 주로에 몰린" 착시가 빠진다.
 * 검증: 2024-01-01 이전으로 계수 추정 → 이후 경주에서 말의 최근 5경주 환산 능력이 다음 경주를 얼마나 맞히나.
 *
 * 실행: npx tsx scripts/probe_track_effect.ts [--trim 1.04]
 */
import { DuckDBInstance } from '@duckdb/node-api';

const STATES = ['건조', '양호', '다습', '포화', '불량'];
const trimArg = Number(process.argv[process.argv.indexOf('--trim') + 1]);
const TRIM = trimArg > 1 ? trimArg : 1.04;
const SPLIT = 20240101;
const tIdx = process.argv.indexOf('--target');
// total=총시간(기존) · total_f=총시간(구간 유효표본만) · early=출발~결승 600m 전 · late=마지막 600m
const TARGET = tIdx > 0 ? process.argv[tIdx + 1] : 'total';
const uIdx = process.argv.indexOf('--until');
const UNTIL = uIdx > 0 ? Number(process.argv[uIdx + 1]) : 99999999; // 이 날짜 미만만 사용(as-of 계수 추정용)

interface Row {
  date: number; rcNo: number; meet: number; hid: number; dist: number; ord: number;
  logt: number; state: number; m: number; bucket: number; cluster: number; race: number; grp: number; cg: number;
}

// prize_cond "R1~65" → 상한 65 (parseClassBand와 동일). 0=최하위(R0~0) … 5=80 초과, -1=알 수 없음
const CLASS_LABELS = ['R0~0(최하)', '~35', '~50', '~65', '~80', '80초과'];
function classGroup(pc: string | null): number {
  const nums = pc?.match(/\d+/g);
  if (!nums) return -1;
  const top = Number(nums[nums.length - 1]);
  return top === 0 ? 0 : top <= 35 ? 1 : top <= 50 ? 2 : top <= 65 ? 3 : top <= 80 ? 4 : 5;
}

async function load(): Promise<Row[]> {
  const inst = await DuckDBInstance.create('data/local.duckdb', { access_mode: 'READ_ONLY' });
  const c = await inst.connect();
  const res = await c.runAndReadAll(`
    select e.race_date d, case when e.meet=4 then 3 else e.meet end meet, e.rc_no, coalesce(e.hr_no, e.hr_name) hk,
           e.rc_dist, e.ord, e.rc_time, e.track_type st, r.track, r.prize_cond pc, e.se_g3f_acc_time s3, e.bu_g3f_acc_time b3
    from race_entries e join races r on r.race_date=e.race_date and r.meet=e.meet and r.rc_no=e.rc_no
    where e.ord is not null and e.rc_time>0 and e.rc_dist between 1000 and 2000 and e.track_type is not null`);
  const raw = res.getRowObjectsJson() as any[];
  const winner = new Map<string, number>();
  for (const r of raw) {
    const k = `${r.d}|${r.meet}|${r.rc_no}`; const t = Number(r.rc_time);
    const cur = winner.get(k);
    if (cur === undefined || t < cur) winner.set(k, t);
  }
  const hids = new Map<string, number>(), bks = new Map<string, number>(), cls = new Map<string, number>(), races = new Map<string, number>();
  const idx = (m: Map<string, number>, k: string) => { let v = m.get(k); if (v === undefined) { v = m.size; m.set(k, v); } return v; };
  const out: Row[] = [];
  for (const r of raw) {
    const k = `${r.d}|${r.meet}|${r.rc_no}`; const t = Number(r.rc_time);
    if (t > winner.get(k)! * TRIM) continue;
    let tt = t;
    if (TARGET !== 'total') {
      const g3 = Number(r.meet) === 1 ? Number(r.s3) : Number(r.b3);
      if (!(g3 > 0) || t - g3 < 30 || t - g3 > 60) continue;
      tt = TARGET === 'early' ? g3 : TARGET === 'late' ? t - g3 : t;
    }
    const s = STATES.indexOf(r.st); if (s < 0) continue;
    const mm = /\((\d+)%\)/.exec(r.track ?? ''); if (!mm) continue;
    const dist = Number(r.rc_dist), meet = Number(r.meet), date = Number(r.d);
    out.push({
      date, rcNo: Number(r.rc_no), meet, hid: idx(hids, String(r.hk)), dist, ord: Number(r.ord),
      logt: Math.log(tt), state: s, m: Number(mm[1]), bucket: idx(bks, `${meet}|${dist}`),
      cluster: idx(cls, `${date}|${meet}`), race: idx(races, k), grp: dist <= 1300 ? 0 : dist <= 1700 ? 1 : 2, cg: classGroup(r.pc),
    });
  }
  return out;
}

// 두 고정효과(말, 버킷)를 번갈아 빼서 제거 (Frisch–Waugh)
function demean(cols: Float64Array[], groups: Int32Array[], sizes: number[]) {
  for (let it = 0; it < 300; it++) {
    let maxd = 0;
    for (let g = 0; g < groups.length; g++) {
      const gi = groups[g];
      const cnt = new Float64Array(sizes[g]);
      for (let i = 0; i < gi.length; i++) cnt[gi[i]]++;
      for (const col of cols) {
        const sum = new Float64Array(sizes[g]);
        for (let i = 0; i < gi.length; i++) sum[gi[i]] += col[i];
        for (let i = 0; i < gi.length; i++) {
          const d = sum[gi[i]] / cnt[gi[i]];
          col[i] -= d;
          if (Math.abs(d) > maxd) maxd = Math.abs(d);
        }
      }
    }
    if (maxd < 1e-10) break;
  }
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function inv(A: number[][]): number[][] {
  const n = A.length;
  const cols = Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (__, i) => (i === j ? 1 : 0))));
  return Array.from({ length: n }, (_, i) => cols.map(col => col[i]));
}

interface Fit { beta: number[]; se: number[]; n: number }
function fit(rows: Row[], xf: (r: Row) => number[]): Fit {
  const n = rows.length, k = xf(rows[0]).length;
  const cols = [new Float64Array(n), ...Array.from({ length: k }, () => new Float64Array(n))];
  rows.forEach((r, i) => { cols[0][i] = r.logt; xf(r).forEach((v, j) => (cols[j + 1][i] = v)); });
  const hid = Int32Array.from(rows, r => r.hid), bk = Int32Array.from(rows, r => r.bucket);
  let maxH = 0, maxB = 0; for (const r of rows) { if (r.hid > maxH) maxH = r.hid; if (r.bucket > maxB) maxB = r.bucket; }
  demean(cols, [hid, bk], [maxH + 1, maxB + 1]);
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += cols[a + 1][i] * cols[0][i]; for (let b = 0; b < k; b++) XtX[a][b] += cols[a + 1][i] * cols[b + 1][i]; }
  const beta = solve(XtX, Xty);
  // 같은 날·같은 경마장 경주는 주로 상태를 공유하므로 (날짜×경마장) 단위 군집 표준오차
  const score = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    let u = cols[0][i]; for (let a = 0; a < k; a++) u -= beta[a] * cols[a + 1][i];
    const s = score.get(rows[i].cluster) ?? new Array(k).fill(0);
    for (let a = 0; a < k; a++) s[a] += cols[a + 1][i] * u;
    score.set(rows[i].cluster, s);
  }
  const meat = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const s of score.values()) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += s[a] * s[b];
  const Xi = inv(XtX);
  const V = Xi.map((_, a) => Xi.map((__, b) => { let v = 0; for (let p = 0; p < k; p++) for (let q = 0; q < k; q++) v += Xi[a][p] * meat[p][q] * Xi[q][b]; return v; }));
  return { beta, se: beta.map((_, a) => Math.sqrt(V[a][a])), n };
}

const dummies = (r: Row) => [1, 2, 3, 4].map(s => (r.state === s ? 1 : 0));
const pct = (b: number) => (100 * (Math.exp(b) - 1)).toFixed(2);

function spearman(xs: number[], ys: number[]): number {
  const rk = (v: number[]) => {
    const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); let i = 0;
    while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; }
    return r;
  };
  const a = rk(xs), b = rk(ys), n = xs.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
}

async function main() {
  const all = (await load()).filter(r => r.date < UNTIL);
  const train = all.filter(r => r.date < SPLIT);
  console.log(`표본: 전체 ${all.length}행(trim ${TRIM}) · 학습(<${SPLIT}) ${train.length}행 · 말 ${new Set(all.map(r => r.hid)).size}`);
  const meanT = (rows: Row[]) => Math.exp(rows.reduce((s, r) => s + r.logt, 0) / rows.length);

  console.log('\n=== [1] 주로 상태 효과 (건조 대비 완주시간 변화 %, 말·경마장×거리 고정) ===');
  const groups: [string, Row[]][] = [
    ['전체', all], ['단거리≤1300', all.filter(r => r.grp === 0)],
    ['중거리1400~1700', all.filter(r => r.grp === 1)], ['장거리≥1800', all.filter(r => r.grp === 2)],
  ];
  for (const [name, rows] of groups) {
    const f = fit(rows, dummies); const T = meanT(rows);
    const line = [1, 2, 3, 4].map((s, j) => `${STATES[s]} +${pct(f.beta[j])}%(95%±${(196 * f.se[j]).toFixed(2)}%p, ≈${(T * (Math.exp(f.beta[j]) - 1)).toFixed(2)}초)`);
    console.log(`${name} n=${f.n}, 평균 ${T.toFixed(1)}초\n   ${line.join(' | ')}`);
  }
  const fm = fit(all, r => [r.m]);
  console.log(`\n함수율 연속: 1%p당 ${pct(fm.beta[0])}% (95%±${(196 * fm.se[0]).toFixed(3)}%p) → 건조2%→불량20% 선형 환산 ${pct(fm.beta[0] * 18)}%`);

  if (TARGET !== 'total') return;
  console.log('\n=== [1b] 등급 밴드별 주로 상태 효과 (건조 대비 %) ===');
  for (let g = 0; g < CLASS_LABELS.length; g++) {
    const rows = all.filter(r => r.cg === g); if (rows.length < 2000) { console.log(`${CLASS_LABELS[g]} n=${rows.length} (표본 부족)`); continue; }
    const f = fit(rows, dummies); const T = meanT(rows);
    const line = [1, 2, 3, 4].map((s, j) => `${STATES[s]} ${pct(f.beta[j])}%(±${(196 * f.se[j]).toFixed(2)})`);
    console.log(`${CLASS_LABELS[g].padEnd(10)} n=${f.n}, 평균 ${T.toFixed(1)}초 | ${line.join(' | ')}`);
  }

  console.log('\n=== [2] 검증: 최근 5경주 환산 능력으로 이후 경주 예측 (학습 <2024, 검증 ≥2024) ===');
  const fS = fit(train, dummies), fM = fit(train, r => [r.m]);
  const fG = [0, 1, 2].map(g => fit(train.filter(r => r.grp === g), dummies));
  const adjS = (r: Row) => (r.state === 0 ? 0 : fS.beta[r.state - 1]);
  const adjG = (r: Row) => (r.state === 0 ? 0 : fG[r.grp].beta[r.state - 1]);
  const adjM = (r: Row) => fM.beta[0] * r.m;
  const base = (adj: (r: Row) => number) => {
    const s = new Map<number, [number, number]>();
    for (const r of train) { const v = s.get(r.bucket) ?? [0, 0]; v[0] += r.logt - adj(r); v[1]++; s.set(r.bucket, v); }
    return (b: number) => { const v = s.get(b); return v ? v[0] / v[1] : NaN; };
  };
  // 현재 ⑳: (버킷×상태)별 우승마 평균시간 par (10승 미만이면 결측)
  const par = new Map<string, [number, number]>();
  for (const r of train) if (r.ord === 1) { const k = `${r.bucket}|${r.state}`; const v = par.get(k) ?? [0, 0]; v[0] += r.logt; v[1]++; par.set(k, v); }
  const logPar = (r: Row) => { const v = par.get(`${r.bucket}|${r.state}`); return v && v[1] >= 10 ? v[0] / v[1] : NaN; };

  const b0 = base(() => 0), bS = base(adjS), bG = base(adjG), bM = base(adjM);
  // 각 방식의 "환산 편차" = 그 경주 기록이 그 조건 기준보다 얼마나 느린가 (작을수록 빠른 말)
  const methods: [string, (r: Row) => number][] = [
    ['P0 보정 없음(경마장×거리만)', r => r.logt - b0(r.bucket)],
    ['P1 현재 ⑳(우승마 par 버킷)', r => r.logt - logPar(r)],
    ['P2 상태 계수(전 거리 공통)', r => r.logt - adjS(r) - bS(r.bucket)],
    ['P3 상태 계수(거리군별)', r => r.logt - adjG(r) - bG(r.bucket)],
    ['P4 함수율 연속', r => r.logt - adjM(r) - bM(r.bucket)],
  ];

  const byHorse = new Map<number, Row[]>();
  for (const r of all) { const l = byHorse.get(r.hid); if (l) l.push(r); else byHorse.set(r.hid, [r]); }
  for (const l of byHorse.values()) l.sort((a, b) => a.date - b.date || a.rcNo - b.rcNo);

  type P = { err: number; race: number; ab: number; ord: number };
  const pred = new Map<string, P>(); // key = 방식|경주|말 → 공통표본 교집합용
  for (const [hid, l] of byHorse) {
    for (let i = 0; i < l.length; i++) {
      const t = l[i]; if (t.date < SPLIT) continue;
      const hist = l.slice(0, i).filter(h => h.date < t.date).slice(-5);
      if (hist.length < 3) continue;
      methods.forEach(([, dev], mi) => {
        const ab = hist.reduce((s, h) => s + dev(h), 0) / hist.length;
        const own = dev(t);
        if (Number.isFinite(ab) && Number.isFinite(own)) pred.set(`${mi}|${t.race}|${hid}`, { err: own - ab, race: t.race, ab, ord: t.ord });
      });
    }
  }
  // 5개 방식 모두 값이 있는 (경주,말)만 비교
  const keys = [...pred.keys()].filter(k => k.startsWith('0|')).map(k => k.slice(2)).filter(k => methods.every((_, mi) => pred.has(`${mi}|${k}`)));
  console.log(`검증 표본(모든 방식 공통) ${keys.length}건`);
  methods.forEach(([name], mi) => {
    const ps = keys.map(k => pred.get(`${mi}|${k}`)!);
    const rmse = Math.sqrt(ps.reduce((s, p) => s + p.err * p.err, 0) / ps.length);
    const byRace = new Map<number, P[]>();
    for (const p of ps) { const g = byRace.get(p.race); if (g) g.push(p); else byRace.set(p.race, [p]); }
    let rs = 0, rn = 0;
    for (const g of byRace.values()) if (g.length >= 5) { const v = spearman(g.map(p => p.ab), g.map(p => p.ord)); if (Number.isFinite(v)) { rs += v; rn++; } }
    console.log(`${name.padEnd(30)} 다음경주 오차 RMSE ${(100 * rmse).toFixed(3)}%  | 경주내 능력↔착순 ρ ${(rs / rn).toFixed(4)} (${rn}경주)`);
  });
}
main().catch(e => { console.error(e); process.exit(1); });
