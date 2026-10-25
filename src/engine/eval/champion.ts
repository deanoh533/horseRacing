import type { ReadClient } from '../../db/localDb.js';
import type { LogisticModel } from '../models/logistic.js';
import type { ScorableModel } from './score.js';

export interface VersionRow {
  id: number;
  label: string;
  model_type: string;
  weights: Record<string, number> | null;
  artifact: LogisticModel | null;
  train_until?: number | null;
  created_at?: string | null;
}

/**
 * 챔피언이 학습에 쓴 데이터의 마지막 날짜(상한).
 * train_until 미기록 버전(v7 이전)은 생성일(KST)로 대신한다 — 생성 이후 데이터는 배울 수 없으므로 보수적.
 */
export function trainBound(
  row: Pick<VersionRow, 'train_until' | 'created_at'>,
): { date: number; source: 'train_until' | 'created_at' } | null {
  if (row.train_until != null) return { date: row.train_until, source: 'train_until' };
  const t = row.created_at ? Date.parse(row.created_at) : NaN;
  if (!Number.isFinite(t)) return null;
  const k = new Date(t + 9 * 60 * 60 * 1000);
  return { date: k.getUTCFullYear() * 10000 + (k.getUTCMonth() + 1) * 100 + k.getUTCDate(), source: 'created_at' };
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
  let q = db.from('model_versions').select('id, label, model_type, weights, artifact, train_until, created_at');
  q = by.id !== undefined ? q.eq('id', by.id) : q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as VersionRow;
  return { row, model: toScorableModel(row) };
}
