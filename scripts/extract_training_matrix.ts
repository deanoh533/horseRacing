/**
 * 학습행렬 추출 — 결과확정(ord NOT NULL) 과거 경주를 순회하며
 * 출전마별 de-biased feature + top3 라벨을 JSONL로 쓴다. (계획 B 모델 학습 입력)
 * win_odds는 buildFeatures에서 제외됨(설계 결정 6).
 *
 * 사용: npm run extract:matrix -- --from 20240101 --to 20991231 --out data/training_matrix.jsonl
 */
import 'dotenv/config';
import { writeFileSync, appendFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { gatherRaceInputs } from '../src/engine/scorePredictor.js';
import { buildRaceFeatures } from '../src/engine/features/relativizeRace.js';

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20240101'));
  const to = Number(arg('--to', '20991231'));
  const out = arg('--out', 'data/training_matrix.jsonl');

  const sb = getSupabaseAdmin();

  const races = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no')
      .gte('race_date', from).lte('race_date', to)
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number }[]) {
      races.add(`${r.race_date}-${r.meet}-${r.rc_no}`);
    }
    if (data.length < PAGE) break;
  }

  writeFileSync(out, '');
  let rows = 0, done = 0;
  for (const key of races) {
    const [d, m, n] = key.split('-').map(Number);
    const inputs = await gatherRaceInputs(sb, d!, m!, n!);
    const { data: oddsRows } = await sb
      .from('race_entries')
      .select('hr_name, win_odds')
      .eq('race_date', d!).eq('meet', m!).eq('rc_no', n!);
    const oddsMap = new Map<string, number | null>(
      (oddsRows ?? []).map((o: { hr_name: string; win_odds: number | null }) => [o.hr_name, o.win_odds])
    );
    // 경주 내 상대화: 필드 = 전 출주마. z-score 계산 후 결과확정 행만 emit.
    const raceFeats = buildRaceFeatures(inputs.map((r) => r.input));
    const lines = inputs
      .map((r, i) => ({ r, f: raceFeats[i]! }))
      .filter(({ r }) => r.ord != null && r.ord <= 50)
      .map(({ r, f }) => JSON.stringify({
        race_date: d, meet: m, rc_no: n, hr_name: r.hr_name,
        ord: r.ord,
        win_odds: oddsMap.get(r.hr_name) ?? null,
        top3: (r.ord as number) <= 3 ? 1 : 0,
        top2: (r.ord as number) <= 2 ? 1 : 0,
        features: f,
      }));
    if (lines.length) { appendFileSync(out, lines.join('\n') + '\n'); rows += lines.length; }
    if (++done % 100 === 0) console.log(`  ${done}/${races.size} races, ${rows} rows`);
  }
  console.log(`✅ ${rows} rows → ${out}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
