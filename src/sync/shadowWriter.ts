/**
 * shadow_predictions 쓰기 (spec 2026-09-18 §4.2~4.3). 라이브 predictions는 건드리지 않는다.
 * 호출부는 반드시 try/catch로 격리 — 여기 예외가 라이브 싱크를 멈추면 안 된다.
 */
import type { ShadowPredictionRow } from '../engine/shadowPredictor.js';

// supabase-js 최소 호환형 (테스트 페이크 주입용)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WriteClient = { from(table: string): any };

export async function writeShadowPredictions(
  sb: WriteClient, rows: ShadowPredictionRow[], source: 'live' | 'backfill',
): Promise<void> {
  if (rows.length === 0) return;
  const groups = new Map<string, ShadowPredictionRow[]>();
  for (const r of rows) {
    const k = `${r.race_date}|${r.meet}|${r.rc_no}|${r.model_version}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  for (const g of groups.values()) {
    const { race_date, meet, rc_no, model_version } = g[0]!;
    const { error: delErr } = await sb.from('shadow_predictions').delete()
      .eq('race_date', race_date).eq('meet', meet).eq('rc_no', rc_no).eq('model_version', model_version);
    if (delErr) throw delErr;
    const { error: insErr } = await sb.from('shadow_predictions').insert(g.map((r) => ({ ...r, source })));
    if (insErr) throw insErr;
  }
}

export async function updateShadowActualOrd(
  sb: WriteClient, rcDate: number, meet: number, rcNo: number,
  results: { hrName: string; ord: number | null }[],
): Promise<void> {
  for (const { hrName, ord } of results) {
    if (ord == null) continue;
    const { error } = await sb.from('shadow_predictions').update({ actual_ord: ord })
      .eq('race_date', rcDate).eq('meet', meet).eq('rc_no', rcNo).eq('hr_name', hrName);
    if (error) throw error;
  }
}
