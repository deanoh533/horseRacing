/**
 * 활성 모델 버전 조회. 라이브 예측은 is_active=true 행을 사용.
 * model_type='logistic'이면 artifact(LogisticModel)로 라이브 스코어링.
 */
import type { ReadClient } from '../db/localDb.js';
import { ITEM_WEIGHTS } from '../types/index.js';
import type { LogisticModel } from './models/logistic.js';

export interface ActiveModelVersion {
  id: number | null;
  label: string;
  model_type: string;                 // 'rho-legacy' | 'logistic'
  weights: Record<string, number>;
  artifact: LogisticModel | null;
}

export async function getActiveModelVersion(
  sb: ReadClient
): Promise<ActiveModelVersion> {
  const { data, error } = await sb
    .from('model_versions')
    .select('id, label, model_type, weights, artifact')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    return {
      id: data.id as number,
      label: data.label as string,
      model_type: (data.model_type as string) ?? 'rho-legacy',
      weights: (data.weights as Record<string, number>) ?? {},
      artifact: (data.artifact as LogisticModel | null) ?? null,
    };
  }
  return { id: null, label: 'v1-fallback', model_type: 'rho-legacy', weights: { ...ITEM_WEIGHTS }, artifact: null };
}
