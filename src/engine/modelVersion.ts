/**
 * 활성 모델 버전 조회
 *
 * 라이브 예측은 model_versions 테이블의 is_active=true 행의 가중치를 사용한다.
 * (코드 상수 ITEM_WEIGHTS는 마이그레이션 전/활성 버전 부재 시 fallback일 뿐)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ITEM_WEIGHTS } from '../types/index.js';

export interface ActiveModelVersion {
  id: number | null;            // predictions.model_version 도장용 (fallback이면 null)
  label: string;
  weights: Record<string, number>;
}

export async function getActiveModelVersion(
  sb: SupabaseClient
): Promise<ActiveModelVersion> {
  const { data, error } = await sb
    .from('model_versions')
    .select('id, label, weights')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    return {
      id: data.id as number,
      label: data.label as string,
      weights: data.weights as Record<string, number>,
    };
  }
  // 활성 버전 없음 → 코드 상수로 fallback (도장은 null)
  return { id: null, label: 'v1-fallback', weights: { ...ITEM_WEIGHTS } };
}
