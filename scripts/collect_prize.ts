/**
 * Stage 1a — API156/raceRsutDtl rsutRkPurse(경주별 상금) 수집 → race_entries.rk_purse UPDATE.
 * 사용: npm run collect:prize -- --from 20240101 --to 20991231
 * 주의: fetch에 AbortController 타임아웃(15s) — collect:combo 무한대기 버그 방지.
 */
import 'dotenv/config';
import pLimit from 'p-limit';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { parsePurse, parseRcNo } from './lib/prizeParse.js';

const KEY = process.env.KRA_API_KEY!;
const ENDPOINT = 'https://apis.data.go.kr/B551015/API156/raceRsutDtl';
const TIMEOUT_MS = 15000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1페이지 호출 + 타임아웃 + 일시오류 재시도(backoff). */
async function fetchPage(qs: URLSearchParams, tag: string, attempts = 4): Promise<any> {
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${ENDPOINT}?${qs}`, { signal: ctrl.signal });
      const txt = await r.text();
      const j = JSON.parse(txt);
      if (j.response?.header?.resultCode !== '00') throw new Error(`API에러 ${j.response?.header?.resultMsg}`);
      return j;
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 120);
      if (i < attempts - 1) await sleep(500 * 2 ** i);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${tag} ${attempts}회 실패: ${lastErr}`);
}

interface Item156 { pthrHrno?: string; schdRaceNo?: string; rsutRkPurse?: string; }

/** (race_dt, rccrs_cd=meet) 하루치 전 경주 결과 → 행 배열. */
async function fetchDay(meet: number, raceDt: number): Promise<Item156[]> {
  const out: Item156[] = [];
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const qs = new URLSearchParams({
      serviceKey: KEY, pageNo: String(pageNo), numOfRows: '100', _type: 'json',
      rccrs_cd: String(meet), race_dt: String(raceDt),
    });
    const j = await fetchPage(qs, `${meet}/${raceDt}`);
    let items = j.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    out.push(...items);
    const total = j.response?.body?.totalCount ?? 0;
    if (pageNo * 100 >= total) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20240101'));
  const to = Number(arg('--to', '20991231'));

  const sb = getSupabaseAdmin();

  // 대상 (race_date, meet) — race_entries에서 distinct
  const dayset = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet').gte('race_date', from).lte('race_date', to)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number }[]) dayset.add(`${r.meet}-${r.race_date}`);
    if (data.length < PAGE) break;
  }
  const days = [...dayset].map((s) => { const [m, d] = s.split('-').map(Number); return { m: m!, d: d! }; });
  console.log(`대상 (날짜×경마장) ${days.length}건`);

  const limit = pLimit(4);
  let done = 0, updated = 0, miss = 0;
  await Promise.all(days.map((day) => limit(async () => {
    try {
      const items = await fetchDay(day.m, day.d);
      for (const it of items) {
        const purse = parsePurse(it.rsutRkPurse);
        const rcNo = parseRcNo(it.schdRaceNo);
        const hrNo = it.pthrHrno ?? null;
        if (purse == null || rcNo == null || !hrNo) { miss++; continue; }
        const { error, count } = await sb.from('race_entries')
          .update({ rk_purse: purse }, { count: 'exact' })
          .eq('race_date', day.d).eq('meet', day.m).eq('rc_no', rcNo).eq('hr_no', hrNo);
        if (error) { miss++; } else { updated += count ?? 0; }
      }
    } catch (e) { console.error(`  ⚠️ ${day.m}/${day.d}:`, (e as Error).message); }
    if (++done % 50 === 0) console.log(`  ${done}/${days.length} 일, ${updated} 행 업데이트, ${miss} 미스`);
  })));
  console.log(`✅ ${updated} 행 rk_purse 채움, ${miss} 미스. → build/verify SQL 실행하세요.`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
