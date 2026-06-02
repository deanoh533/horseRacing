/**
 * 속도능력지수 abilityRaw 전역 분포 측정 → 매핑 상수(LO/HI) 결정 (읽기 전용)
 *
 * 모든 (말×경주)의 as-of abilityRaw를 계산해 분포(p5·p50·p95)를 출력한다.
 * 사용: npx tsx scripts/probe_speed_figure.ts
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { parBucketKey, raceSpeedFigure, computeAbilityRaw, loadParMap } from '../src/engine/speedFigure.js';
import { SPEED_FIGURE_N } from '../src/engine/scoreItems/20_speed_figure.js';

async function main() {
  const sb = getSupabaseAdmin();
  const parMap = await loadParMap(sb);
  console.log(`par 버킷(유효): ${parMap.size}`);

  // 전체 race_entries 완주기록 1회 로드 → 말별 최신순 figure 타임라인
  type Row = { race_date: number; meet: number; rc_no: number; hr_name: string; rc_dist: number | null; track_type: string | null; rc_time: number | null };
  const rows: Row[] = [];
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
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // 말별 (최신순) figure 리스트
  const byHorse = new Map<string, number[]>();
  for (const r of rows) {
    if (r.rc_time == null || r.rc_dist == null || r.track_type == null) continue;
    const par = parMap.get(parBucketKey(r.meet, r.rc_dist, r.track_type));
    if (par == null) continue;
    const f = raceSpeedFigure(r.rc_time, par);
    if (f == null) continue;
    if (!byHorse.has(r.hr_name)) byHorse.set(r.hr_name, []);
    byHorse.get(r.hr_name)!.push(f); // rows가 최신순이라 push 순서 = 최신순
  }

  // 각 말의 "현재 시점" abilityRaw (최근 N평균) 분포 — 매핑이 보게 될 값의 대표
  const abilities: number[] = [];
  for (const figs of byHorse.values()) {
    const a = computeAbilityRaw(figs, SPEED_FIGURE_N);
    if (a != null) abilities.push(a);
  }
  abilities.sort((a, b) => a - b);
  const q = (p: number) => abilities[Math.floor((abilities.length - 1) * p)];
  console.log(`abilityRaw 표본: ${abilities.length}`);
  console.log(`p5=${q(0.05).toFixed(4)} p25=${q(0.25).toFixed(4)} p50=${q(0.5).toFixed(4)} p75=${q(0.75).toFixed(4)} p95=${q(0.95).toFixed(4)}`);
  console.log(`→ 권장 LO=p5=${q(0.05).toFixed(3)}, HI=p95=${q(0.95).toFixed(3)}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
