/**
 * predictions.item_scores에 20_speed_figure 키만 머지 (append-only, 다른 키 불변)
 *
 * v1에서 ⑳ 가중치=0 → total_score·predicted_rank 불변. 라이브 기록 보존.
 * 사용: npx tsx scripts/backfill_speed_figure.ts
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { parBucketKey, raceSpeedFigure, computeAbilityRaw, figuresBeforeDate, loadParMap } from '../src/engine/speedFigure.js';
import { calculateSpeedFigureScore, SPEED_FIGURE_N } from '../src/engine/scoreItems/20_speed_figure.js';
import { ITEM_NAMES } from '../src/types/index.js';

async function main() {
  const sb = getSupabaseAdmin();
  const parMap = await loadParMap(sb);

  // 1) 전체 race_entries 완주기록 1회 로드 → 말별 (날짜,figure) 타임라인 (최신순)
  type ReRow = { race_date: number; meet: number; rc_no: number; hr_name: string; rc_dist: number | null; track_type: string | null; rc_time: number | null };
  const reRows: ReRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no, hr_name, rc_dist, track_type, rc_time')
      .not('ord', 'is', null)
      .order('race_date', { ascending: false })
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    reRows.push(...(data as ReRow[]));
    if (data.length < PAGE) break;
  }
  const byHorse = new Map<string, { date: number; fig: number }[]>();
  for (const r of reRows) {
    if (r.rc_time == null || r.rc_dist == null || r.track_type == null) continue;
    const par = parMap.get(parBucketKey(r.meet, r.rc_dist, r.track_type));
    if (par == null) continue;
    const f = raceSpeedFigure(r.rc_time, par);
    if (f == null) continue;
    if (!byHorse.has(r.hr_name)) byHorse.set(r.hr_name, []);
    byHorse.get(r.hr_name)!.push({ date: r.race_date, fig: f }); // 최신순 유지
  }

  // 2) 전체 predictions 로드
  type PredRow = { id: number; race_date: number; hr_name: string; item_scores: Record<string, unknown> | null };
  const preds: PredRow[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('predictions')
      .select('id, race_date, hr_name, item_scores')
      .order('id')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    preds.push(...(data as PredRow[]));
    if (data.length < PAGE) break;
  }
  console.log(`predictions: ${preds.length}행, 말 타임라인: ${byHorse.size}`);

  // 3) 각 prediction: as-of abilityRaw → rawScore → item_scores 머지 → update
  //    38K행 → 병렬 청크로 update (round-trip 시간 단축)
  const itemName = (ITEM_NAMES as Record<string, string>)['20_speed_figure'];
  const CHUNK = 50;
  let updated = 0;
  for (let i = 0; i < preds.length; i += CHUNK) {
    const chunk = preds.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (p) => {
        const timeline = byHorse.get(p.hr_name) ?? [];
        const figs = figuresBeforeDate(timeline, p.race_date); // as-of: 예측일 미만만 (최신순)
        const abilityRaw = computeAbilityRaw(figs, SPEED_FIGURE_N);
        const rawScore = Math.round(calculateSpeedFigureScore({ abilityRaw }) * 1000) / 1000;
        const merged = {
          ...(p.item_scores ?? {}),
          '20_speed_figure': { itemId: '20_speed_figure', itemName, rawScore, weight: 0, weightedScore: 0, status: 'implemented' },
        };
        const { error } = await sb.from('predictions').update({ item_scores: merged }).eq('id', p.id);
        if (error) throw error;
      })
    );
    updated += chunk.length;
    if (i % 2000 < CHUNK) console.log(`  ${updated}/${preds.length}`);
  }
  console.log(`✅ ${updated}행에 20_speed_figure 머지 완료 (total_score·rank 불변)`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
