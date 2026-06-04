-- ============================================
-- 012_model_logistic.sql
-- 로지스틱 모델을 model_versions에 저장 가능하게 확장.
-- 순수 추가형(멱등). 기존 rho-legacy 버전 영향 없음.
-- ============================================

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS model_type TEXT NOT NULL DEFAULT 'rho-legacy';

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS artifact JSONB;

-- ⑳ 속도능력지수 항목 레지스트리 보강(피처→항목 매핑 대상; 없으면 추가)
INSERT INTO score_items (item_id, name) VALUES
  ('20_speed_figure', '속도능력지수')
ON CONFLICT (item_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
