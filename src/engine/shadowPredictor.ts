/**
 * 섀도(실험) 버전 채점. 라이브 predictRace와 분리된 호출 — 여기서 난 예외는 호출부가 격리한다.
 * spec: docs/superpowers/specs/2026-09-18-shadow-lab-design.md §4.1
 */
import type { ReadClient } from '../db/localDb.js';
import { getShadowModelVersions, type ShadowModelVersion } from './modelVersion.js';
import { gatherRaceInputs, scoreRaceRows } from './scorePredictor.js';

export interface ShadowPredictionRow {
  race_date: number; meet: number; rc_no: number; hr_name: string;
  model_version: number; total_score: number; predicted_rank: number;
  p_top3: number | null; actual_ord: number | null;
}

export async function predictShadows(
  sb: ReadClient, rcDate: number, meet: number, rcNo: number,
  opts?: { forcePrecompetition?: boolean; versionIds?: number[]; versions?: ShadowModelVersion[] },
): Promise<ShadowPredictionRow[]> {
  let versions = opts?.versions ?? await getShadowModelVersions(sb);
  if (opts?.versionIds) versions = versions.filter((v) => opts.versionIds!.includes(v.id as number));
  if (versions.length === 0) return [];

  const gatherOpts = opts?.forcePrecompetition ? { forcePrecompetition: true } : undefined;
  const rows = await gatherRaceInputs(sb, rcDate, meet, rcNo, gatherOpts);
  if (rows.length === 0) return [];

  return versions.flatMap((v) =>
    scoreRaceRows(rows, v, rcDate, meet, rcNo).map((p) => ({
      race_date: p.race_date, meet: p.meet, rc_no: p.rc_no, hr_name: p.hr_name,
      model_version: v.id as number, total_score: p.total_score, predicted_rank: p.predicted_rank,
      p_top3: p.p_top3, actual_ord: p.actual_ord,
    })),
  );
}
