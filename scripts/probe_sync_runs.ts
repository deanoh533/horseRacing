// scripts/probe_sync_runs.ts
/**
 * 무인 sync 전수조사 — Actions 실행 이력·로그를 긁어 운영 지표를 한 번에 낸다.
 *
 * 왜 필요한가: `gh run list`의 성패로는 아무것도 안 보인다. **폴러는 KRA가 전부
 * 실패해도 exit 0**이다(다음 폴이 메우므로 빨간불을 안 띄운다). 2026-09-21 전수조사는
 * 실행 142건이 전부 초록불인데 KRA 전멸률이 17~58%였고, 그걸 알아내는 데 로그를
 * 손으로 긁어야 했다. 이 스크립트가 그 수작업을 대신한다.
 *
 * `probe:sync-health`(DB에 데이터가 찼나)와 짝이다 — 이쪽은 "어떻게 채워졌나"를 본다.
 *
 * 사용:
 *   npm run probe:sync-runs                    # 최근 7일
 *   npm run probe:sync-runs -- --from 2026-09-18
 *   npm run probe:sync-runs -- --from 2026-09-18 --full   # 짧은 폴 로그까지 전부
 *
 * 전제: `gh` CLI 로그인. KRA는 안 부른다(쿼터 소비 없음).
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import {
  parseRunLog, verdictOf, estimateKraCalls, resultArrivalByRace, hhmmToMinutes,
  type RunVerdict,
} from '../src/sync/runAuditLogic.js';
import { parseStTime } from '../src/sync/resultsPollLogic.js';

const REPO = 'deanoh533/horseRacing';
const WORKFLOW_ID = 312042997; // sync.yml
/** 폴러 알람 창 — cron-job.org가 KST 10:00~21:45를 15분 간격으로 띄운다 */
const POLL_SLOTS_PER_DAY = 48;
/**
 * 이 시간(초) 미만이면 KRA를 안 부른 폴로 본다 — 로그를 안 받아 시간을 아낀다.
 * 근거: KRA 타임아웃이 30초라 실패도 30초+, 데이터를 받은 성공도 30초+다.
 * `--full`로 끌 수 있다.
 */
const NO_CALL_SECONDS = 25;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(name);

const gh = (args: string[]): string =>
  execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 200e6 });
const ghJson = <T>(path: string): T => JSON.parse(gh(['api', path])) as T;

const kstParts = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return {
    day: d.toISOString().slice(5, 10),            // MM-DD
    time: d.toISOString().slice(11, 16),          // HH:MM
    dow: '일월화수목금토'[d.getUTCDay()]!,
    ymd: Number(d.toISOString().slice(0, 10).replace(/-/g, '')),
  };
};

interface JobRow {
  runId: number; day: string; time: string; dow: string; ymd: number;
  external: boolean; job: '출마표' | '결과폴러' | '결과캐치업' | '기타';
  conclusion: string; seconds: number;
}

function jobKind(name: string): JobRow['job'] {
  if (name.includes('폴러')) return '결과폴러';
  if (name.includes('캐치업')) return '결과캐치업';
  if (name.includes('출마표')) return '출마표';
  return '기타';
}

function fetchJobs(from: string): JobRow[] {
  const runs: Array<{ id: number; created_at: string; event: string }> = [];
  for (let page = 1; page <= 10; page++) {
    const res = ghJson<{ workflow_runs: typeof runs }>(
      `repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=100&page=${page}&created=>=${from}`
    );
    runs.push(...res.workflow_runs);
    if (res.workflow_runs.length < 100) break;
  }

  const rows: JobRow[] = [];
  for (const r of runs.reverse()) {
    const { jobs } = ghJson<{
      jobs: Array<{ name: string; conclusion: string | null; started_at: string; completed_at: string | null }>;
    }>(`repos/${REPO}/actions/runs/${r.id}/jobs`);
    for (const j of jobs) {
      if (j.conclusion === 'skipped') continue;
      const p = kstParts(r.created_at);
      rows.push({
        runId: r.id, ...p,
        // workflow_dispatch = 외부 알람(cron-job.org)이나 설정탭 버튼. schedule = GitHub 예약.
        external: r.event !== 'schedule',
        job: jobKind(j.name),
        conclusion: j.conclusion ?? '진행중',
        seconds: j.completed_at
          ? Math.round((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000)
          : 0,
      });
    }
  }
  return rows;
}

const VERDICT_LABEL: Record<RunVerdict, string> = {
  noCall: 'KRA 안 부름', allFail: '전멸', partial: '조합배당만 실패', ok: '성공',
};

async function main(): Promise<void> {
  const from = arg('--from') ?? (() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const full = has('--full');

  console.log(`\n📡 무인 sync 실행 점검 — ${from} 이후 (KST 기준)\n`);
  const jobs = fetchJobs(from);
  if (jobs.length === 0) {
    console.log('해당 기간 실행 없음.');
    return;
  }

  // ── ① 실행 요약 ────────────────────────────────────────────
  console.log('── 실행 횟수 ──');
  console.log('   일자      잡          알람  예약   결과');
  const byDayJob = new Map<string, { ext: number; sch: number; concl: Map<string, number> }>();
  for (const j of jobs) {
    const k = `${j.day}(${j.dow}) ${j.job}`;
    const e = byDayJob.get(k) ?? { ext: 0, sch: 0, concl: new Map() };
    if (j.external) e.ext++; else e.sch++;
    e.concl.set(j.conclusion, (e.concl.get(j.conclusion) ?? 0) + 1);
    byDayJob.set(k, e);
  }
  for (const k of [...byDayJob.keys()].sort()) {
    const e = byDayJob.get(k)!;
    const concl = [...e.concl].map(([c, n]) => `${c} ${n}`).join(', ');
    console.log(`   ${k.padEnd(20)} ${String(e.ext).padStart(4)}  ${String(e.sch).padStart(4)}   ${concl}`);
  }

  // ── ② 알람 무결성 ──────────────────────────────────────────
  // 외부 알람이 하루 48번 빠짐없이 떴나. GitHub 예약은 실측 6~7%만 실행되므로 비교만 한다.
  console.log('\n── 폴러 알람 무결성 (기대: 외부 알람 하루 48회) ──');
  const pollDays = new Map<string, { ext: number; sch: number }>();
  for (const j of jobs.filter((x) => x.job === '결과폴러')) {
    const e = pollDays.get(`${j.day}(${j.dow})`) ?? { ext: 0, sch: 0 };
    if (j.external) e.ext++; else e.sch++;
    pollDays.set(`${j.day}(${j.dow})`, e);
  }
  for (const [d, e] of [...pollDays].sort()) {
    const pct = Math.round((e.ext / POLL_SLOTS_PER_DAY) * 100);
    const mark = e.ext >= POLL_SLOTS_PER_DAY ? '✅' : e.ext >= POLL_SLOTS_PER_DAY * 0.9 ? '⚠️ ' : '❌';
    console.log(
      `   ${mark} ${d}  외부 알람 ${String(e.ext).padStart(2)}/48 (${pct}%)` +
      `   · GitHub 예약 ${e.sch}회 실행`
    );
  }

  // ── ③ 로그 파싱 ────────────────────────────────────────────
  const targets = jobs.filter((j) => full || j.job !== '결과폴러' || j.seconds >= NO_CALL_SECONDS);
  console.log(
    `\n── KRA 호출 결과 (로그 ${targets.length}/${jobs.length}건 확인` +
    `${full ? '' : `, 폴러 ${NO_CALL_SECONDS}초 미만은 KRA 미호출로 간주 — --full로 전부 확인`}) ──`
  );

  type PollPoint = { time: string; races: number; called: boolean };
  const pollsByDay = new Map<string, PollPoint[]>();
  const dayStat = new Map<string, Record<RunVerdict, number> & { calls: number; comboFail: number }>();
  const blank = () => ({ noCall: 0, allFail: 0, partial: 0, ok: 0, calls: 0, comboFail: 0 });

  for (const j of jobs) {
    const key = `${j.day}(${j.dow})`;
    const s = dayStat.get(key) ?? blank();

    if (!targets.includes(j)) {
      // 로그를 안 받은 짧은 폴 = KRA 미호출
      s.noCall++;
      dayStat.set(key, s);
      if (j.job === '결과폴러') {
        const arr = pollsByDay.get(key) ?? [];
        arr.push({ time: j.time, races: 0, called: false });
        pollsByDay.set(key, arr);
      }
      continue;
    }

    let log: string;
    try {
      log = gh(['run', 'view', '-R', REPO, String(j.runId), '--log']);
    } catch {
      console.log(`   ⚠️  ${j.day} ${j.time} ${j.job} — 로그 못 받음 (만료됐거나 권한 부족)`);
      continue;
    }
    const f = parseRunLog(log);
    const v = verdictOf(f);
    s[v]++;
    s.comboFail += f.comboFailedRaces;
    s.calls += estimateKraCalls(f, f.racesByMeet.size || 2);
    dayStat.set(key, s);

    if (j.job === '결과폴러') {
      const arr = pollsByDay.get(key) ?? [];
      // 경마장이 여럿이어도 그날 경주는 보통 한쪽에만 있다 — 합계로 진행도를 본다
      const races = [...f.racesByMeet.values()].reduce((a, b) => a + b, 0);
      arr.push({ time: j.time, races, called: f.calledKra });
      pollsByDay.set(key, arr);
    }
    // 캐치업이 "구멍 없음"으로 KRA를 안 부르는 건 정상이라 알리지 않는다
    if (j.job !== '결과폴러' && (v === 'allFail' || v === 'partial')) {
      console.log(`   ❗ ${j.day} ${j.time} ${j.job} — ${VERDICT_LABEL[v]}`);
    }
  }

  console.log('\n   일자        부름   전멸  조합실패  성공   전멸률   KRA 호출(추정)');
  for (const [d, s] of [...dayStat].sort()) {
    const called = s.allFail + s.partial + s.ok;
    const rate = called > 0 ? Math.round((s.allFail / called) * 100) : 0;
    const mark = rate >= 50 ? '❌' : rate >= 20 ? '⚠️ ' : '✅';
    console.log(
      `   ${mark} ${d}  ${String(called).padStart(4)}  ${String(s.allFail).padStart(5)}` +
      `  ${String(s.partial).padStart(4)}(${s.comboFail}경주)  ${String(s.ok).padStart(4)}` +
      `  ${String(rate + '%').padStart(6)}   ${String(s.calls).padStart(6)}`
    );
  }
  console.log('   ※ KRA 호출은 하한 추정(재시도 1회차만 집계). 일일 한도 3,000.');

  // ── ④ 결과 도착 지연 ───────────────────────────────────────
  // race_entries.result_at은 폴러가 매번 덮어써서 못 쓴다 → 로그 진행 + DB 발주시각으로 복원
  console.log('\n── 결과 도착 지연 (발주시각 → DB) ──');
  const sb = getSupabaseAdmin();
  for (const [d, polls] of [...pollsByDay].sort()) {
    const ymd = jobs.find((j) => `${j.day}(${j.dow})` === d)!.ymd;
    const { data: races } = await sb.from('races')
      .select('meet,rc_no,st_time').eq('race_date', ymd).order('meet').order('rc_no');
    if (!races || races.length === 0) continue;

    polls.sort((a, b) => a.time.localeCompare(b.time));
    const arrival = resultArrivalByRace(polls);
    const lags: number[] = [];
    for (let i = 0; i < races.length; i++) {
      const post = parseStTime(races[i]!.st_time as string | null);
      const at = arrival.get(i + 1);
      if (post == null || !at) continue;
      const mins = hhmmToMinutes(at);
      if (mins == null) continue;
      lags.push(mins - post);
    }
    if (lags.length === 0) { console.log(`   ${d}  측정 불가 (발주시각·진행 로그 부족)`); continue; }
    const sorted = [...lags].sort((a, b) => a - b);
    console.log(
      `   ${d}  ${races.length}경주 중 ${lags.length}건 측정` +
      ` — 최소 ${sorted[0]}분 / 중앙 ${sorted[Math.floor(sorted.length / 2)]}분 / 최대 ${sorted[sorted.length - 1]}분`
    );
  }
  console.log('   ※ 여유 15분 + 폴 간격 15분이라 이론 최소는 15~30분이다.');
  console.log();
}

main().catch((e) => {
  console.error('❌', (e as Error).message);
  process.exit(1);
});
