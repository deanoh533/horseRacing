/**
 * Stage 2 Phase 2A — 복연승 확정배당 수집 (읽기전용 외부 API).
 * API160_1/integratedInfo_1 호출 → pool=='복연승식' 추출 → data/combo_dividends.jsonl.
 * 사용: npm run collect:combo -- --from 20250101 --to 20991231 --out data/combo_dividends.jsonl
 */
import 'dotenv/config';
import { writeFileSync, appendFileSync } from 'node:fs';
import pLimit from 'p-limit';
import { getSupabaseAdmin } from '../src/db/supabase.js';

const KEY = process.env.KRA_API_KEY!;
const ENDPOINT = 'https://apis.data.go.kr/B551015/API160_1/integratedInfo_1';

interface DivItem { chulNo: number; chulNo2: number; chulNo3: number; odds: number; pool: string; rcNo: number; }

async function fetchRace(meet: number, rcDate: number, rcNo: number): Promise<DivItem[]> {
  const out: DivItem[] = [];
  for (let pageNo = 1; pageNo <= 5; pageNo++) {
    const qs = new URLSearchParams({
      serviceKey: KEY, pageNo: String(pageNo), numOfRows: '1000', _type: 'json',
      rc_date: String(rcDate), meet: String(meet), rc_no: String(rcNo),
    });
    const r = await fetch(`${ENDPOINT}?${qs}`);
    const txt = await r.text();
    let j: any;
    try { j = JSON.parse(txt); } catch { throw new Error(`비JSON 응답 ${meet}/${rcDate}/${rcNo}: ${txt.slice(0, 120)}`); }
    if (j.response?.header?.resultCode !== '00') throw new Error(`API에러 ${j.response?.header?.resultMsg}`);
    let items = j.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    out.push(...items);
    const total = j.response?.body?.totalCount ?? 0;
    if (pageNo * 1000 >= total) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20250101'));
  const to = Number(arg('--to', '20991231'));
  const out = arg('--out', 'data/combo_dividends.jsonl');

  const sb = getSupabaseAdmin();
  const races: { d: number; m: number; n: number }[] = [];
  const PAGE = 1000;
  const seen = new Set<string>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no')
      .gte('race_date', from).lte('race_date', to).not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number }[]) {
      const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
      if (!seen.has(k)) { seen.add(k); races.push({ d: r.race_date, m: r.meet, n: r.rc_no }); }
    }
    if (data.length < PAGE) break;
  }
  console.log(`대상 경주 ${races.length}건 → ${out}`);

  writeFileSync(out, '');
  const limit = pLimit(4);
  let done = 0, rows = 0;
  await Promise.all(races.map((rc) => limit(async () => {
    try {
      const items = await fetchRace(rc.m, rc.d, rc.n);
      const lines = items
        .filter((it) => it.pool === '복연승식')
        .map((it) => {
          const a = Math.min(it.chulNo, it.chulNo2), b = Math.max(it.chulNo, it.chulNo2);
          return JSON.stringify({ race_date: rc.d, meet: rc.m, rc_no: rc.n, a, b, odds: it.odds });
        });
      if (lines.length) { appendFileSync(out, lines.join('\n') + '\n'); rows += lines.length; }
    } catch (e) { console.error(`  ⚠️ ${rc.d}/${rc.m}/${rc.n}:`, (e as Error).message); }
    if (++done % 50 === 0) console.log(`  ${done}/${races.length} 경주, ${rows} 조합행`);
  })));
  console.log(`✅ ${rows} 복연승 조합행 → ${out}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
