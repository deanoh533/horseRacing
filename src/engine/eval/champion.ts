import type { ReadClient } from '../../db/localDb.js';
import type { LogisticModel } from '../models/logistic.js';
import type { ScorableModel } from './score.js';

export interface VersionRow {
  id: number;
  label: string;
  model_type: string;
  weights: Record<string, number> | null;
  artifact: LogisticModel | null;
}

/** model_versions 한 행 → ScorableModel. logistic+유효artifact면 logistic, 아니면 weights 폴백. */
export function toScorableModel(row: VersionRow): ScorableModel {
  const a = row.artifact;
  if (row.model_type === 'logistic' && a && Array.isArray(a.features) && a.features.length > 0) {
    return { kind: 'logistic', model: a };
  }
  if (row.model_type === 'logistic') {
    console.warn(`  ⚠️  버전 ${row.id}(${row.label}) logistic이나 artifact 없음 → weights 폴백`);
  }
  return { kind: 'weights', weights: row.weights ?? {} };
}

/** 활성(is_active) 또는 id 지정 버전을 DuckDB에서 로드. */
export async function loadVersion(
  db: ReadClient,
  by: { id?: number } = {}
): Promise<{ row: VersionRow; model: ScorableModel } | null> {
  let q = db.from('model_versions').select('id, label, model_type, weights, artifact');
  q = by.id !== undefined ? q.eq('id', by.id) : q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as VersionRow;
  return { row, model: toScorableModel(row) };
}
