/**
 * 4두 박스 구간별 회수율 — 인기 1위 배당 강약 / 모델 확신도 구간별 복승·삼복승 박스 회수율.
 * 스펙 docs/superpowers/specs/2026-10-29-box-segment-prereg.md · 로컬 미러만(DB·KRA 0회).
 *
 * 실행: npm run probe:box-seg                              — 사전등록 판정 (2026-11-01~12-31, 2027-01-01 전 실행 거부)
 *       npm run probe:box-seg -- --from 20260731 --to 20261031 — 탐색 구간 재현 (판정 아님)
 *
 * 대상 = 라이브 예측(경주일 전날까지 생성, KST)이 있고 상위 4두 마번이 모두 잡히며 조합배당(복승·삼복승)이 있는 경주.
 * 박스 = 예측 1~4순위, 복승 6조합·삼복승 4조합 각 100원. 배당은 확정배당.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import {
  favSegment, confSegment, judgeBoxSegments, BOX_SEG_RULE,
  type FavSeg, type ConfSeg, type SegTally,
} from '../src/engine/eval/boxSegments.js';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const PREREG_FROM = 20261101;
const PREREG_TO = 20261231;
const FROM = arg('--from', PREREG_FROM);
const TO = arg('--to', PREREG_TO);
const PREREG_OPEN = Date.UTC(2026, 11, 31, 15); // 2027-01-01 00:00 KST

interface RaceRow {
  race_date: number; meet: number; rc_no: number;
  fav_odds: number | null; top_pwin: number | null;
  q_cost: number; q_payout: number; q_hit: boolean;
  t_cost: number; t_payout: number; t_hit: boolean;
}

async function main(): Promise<void> {
  const overlapsPrereg = FROM <= PREREG_TO && TO >= PREREG_FROM;
  if (overlapsPrereg && Date.now() < PREREG_OPEN) {
    throw new Error('사전등록 시험 구간(2026-11~12)은 2027-01-01 이후에만 열람 (스펙 §4) — 탐색은 --from/--to로 그 밖의 구간만');
  }
  const inst = await DuckDBInstance.create('data/local.duckdb', { access_mode: 'READ_ONLY' });
  const c = await inst.connect();
  const res = await c.runAndReadAll(`
    with pre as (  -- 경주일 전날까지 만들어진 라이브 예측만 (사후 재생성분 제외)
      select p.race_date, p.meet, p.rc_no, p.predicted_rank, p.p_win, e.pthr_no
      from predictions p
      join race_entries e on e.race_date = p.race_date and e.meet = p.meet and e.rc_no = p.rc_no and e.hr_name = p.hr_name
      where p.race_date between ${FROM} and ${TO} and p.predicted_rank between 1 and 4
        and cast(timezone('Asia/Seoul', p.created_at) as date) < strptime(cast(p.race_date as varchar), '%Y%m%d')::date
    ),
    ok as (
      select race_date, meet, rc_no, max(case when predicted_rank = 1 then p_win end) as top_pwin
      from pre group by 1,2,3 having count(distinct pthr_no) = 4
    ),
    ri as (
      select race_date, meet, rc_no, min(case when win_odds > 0 then win_odds end) as fav_odds,
        max(case when ord = 1 then pthr_no end) g1, max(case when ord = 2 then pthr_no end) g2, max(case when ord = 3 then pthr_no end) g3
      from race_entries join ok using (race_date, meet, rc_no) where ord between 1 and 30 group by 1,2,3
    ),
    cand as (
      select d.race_date, d.meet, d.rc_no, d.pool, d.odds,
        case when d.pool = '복승식' then list_sort([d.leg1, d.leg2]) = list_sort([ri.g1, ri.g2])
             else list_sort([d.leg1, d.leg2, d.leg3]) = list_sort([ri.g1, ri.g2, ri.g3]) end as hit
      from combo_dividends d join ri using (race_date, meet, rc_no)
      where d.pool in ('복승식', '삼복승식')
        and exists (select 1 from pre b where b.race_date = d.race_date and b.meet = d.meet and b.rc_no = d.rc_no and b.pthr_no = d.leg1)
        and exists (select 1 from pre b where b.race_date = d.race_date and b.meet = d.meet and b.rc_no = d.rc_no and b.pthr_no = d.leg2)
        and (d.leg3 = 0 or exists (select 1 from pre b where b.race_date = d.race_date and b.meet = d.meet and b.rc_no = d.rc_no and b.pthr_no = d.leg3))
    )
    select ri.race_date, ri.meet, ri.rc_no, ri.fav_odds, ok.top_pwin,
      sum(case when c.pool = '복승식' then 100 else 0 end) as q_cost,
      sum(case when c.pool = '복승식' and c.hit then round(c.odds * 100) else 0 end) as q_payout,
      bool_or(c.pool = '복승식' and c.hit) as q_hit,
      sum(case when c.pool = '삼복승식' then 100 else 0 end) as t_cost,
      sum(case when c.pool = '삼복승식' and c.hit then round(c.odds * 100) else 0 end) as t_payout,
      bool_or(c.pool = '삼복승식' and c.hit) as t_hit
    from ri join ok using (race_date, meet, rc_no) join cand c using (race_date, meet, rc_no)
    group by 1,2,3,4,5
    having sum(case when c.pool = '삼복승식' then 1 else 0 end) > 0
  `);
  const races = res.getRowObjects().map((o) => ({
    race_date: Number(o.race_date), meet: Number(o.meet), rc_no: Number(o.rc_no),
    fav_odds: o.fav_odds == null ? null : Number(o.fav_odds),
    top_pwin: o.top_pwin == null ? null : Number(o.top_pwin),
    q_cost: Number(o.q_cost), q_payout: Number(o.q_payout), q_hit: Boolean(o.q_hit),
    t_cost: Number(o.t_cost), t_payout: Number(o.t_payout), t_hit: Boolean(o.t_hit),
  })) as RaceRow[];
  const usable = races.filter((r) => r.fav_odds != null && r.top_pwin != null);
  console.log(`${FROM}~${TO} · 대상 ${usable.length}경주 (배당·확신도 결측 제외 ${races.length - usable.length})`);
  if (usable.length === 0) return;

  const empty = (): SegTally => ({ races: 0, hits: 0, cost: 0, payout: 0 });
  const tally = <K extends string>(keys: K[], seg: (r: RaceRow) => K, pool: 'q' | 't') => {
    const out = Object.fromEntries(keys.map((k) => [k, empty()])) as Record<K, SegTally>;
    for (const r of usable) {
      const t = out[seg(r)];
      t.races++;
      if (pool === 'q' ? r.q_hit : r.t_hit) t.hits++;
      t.cost += pool === 'q' ? r.q_cost : r.t_cost;
      t.payout += pool === 'q' ? r.q_payout : r.t_payout;
    }
    return out;
  };
  const FAV: FavSeg[] = ['strong', 'normal', 'open'];
  const CONF: ConfSeg[] = ['low', 'mid', 'high'];
  const favOf = (r: RaceRow) => favSegment(r.fav_odds!);
  const confOf = (r: RaceRow) => confSegment(r.top_pwin!);
  const LABEL: Record<string, string> = {
    strong: `강한 인기마 (≤${BOX_SEG_RULE.favCuts[0]}배)`, normal: '보통', open: `혼전 (${BOX_SEG_RULE.favCuts[1]}배+)`,
    low: `확신 낮음 (<${BOX_SEG_RULE.confCuts[0]})`, mid: '확신 중간', high: `확신 높음 (≥${BOX_SEG_RULE.confCuts[1]})`,
  };
  const pct = (t: SegTally) => (t.cost > 0 ? `${((t.payout / t.cost) * 100).toFixed(1)}%` : '—');
  const print = (title: string, keys: string[], q: Record<string, SegTally>, t: Record<string, SegTally>) => {
    console.log(`\n[${title}]   구간 | 경주 | 복승 적중·회수율 | 삼복승 적중·회수율`);
    for (const k of keys) {
      console.log(`  ${LABEL[k]!.padEnd(22)} ${String(q[k]!.races).padStart(4)} | ${String(q[k]!.hits).padStart(4)} ${pct(q[k]!).padStart(7)} | ${String(t[k]!.hits).padStart(4)} ${pct(t[k]!).padStart(7)}`);
    }
  };
  const qFav = tally(FAV, favOf, 'q'), tFav = tally(FAV, favOf, 't');
  const qConf = tally(CONF, confOf, 'q'), tConf = tally(CONF, confOf, 't');
  print('인기 1위 단승 배당', FAV, qFav, tFav);
  print('모델 1순위 우승확률', CONF, qConf, tConf);

  const j = judgeBoxSegments({ fav: qFav, conf: qConf });
  const all = (pool: 'q' | 't') => {
    const cost = usable.reduce((s, r) => s + (pool === 'q' ? r.q_cost : r.t_cost), 0);
    const pay = usable.reduce((s, r) => s + (pool === 'q' ? r.q_payout : r.t_payout), 0);
    return `${((pay / cost) * 100).toFixed(1)}%`;
  };
  console.log(`\n전체 박스 회수율: 복승 ${all('q')} · 삼복승 ${all('t')}`);
  const tag = overlapsPrereg ? '판정' : '참고(탐색 구간 — 판정 아님)';
  console.log(`[${tag}] H1 보통 구간 복승 > 전체·강함·혼전: ${j.h1 ? '✅' : '❌'}`);
  console.log(`[${tag}] H2 확신 중간 복승 > 전체·높음: ${j.h2 ? '✅' : '❌'}`);
}

main().catch((e) => { console.error('💥', (e as Error).message); process.exit(1); });
