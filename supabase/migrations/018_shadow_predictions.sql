-- ============================================
-- 018_shadow_predictions.sql
-- 섀도(실험) 버전 예측 저장. 라이브 predictions와 완전 분리.
-- spec: docs/superpowers/specs/2026-09-18-shadow-lab-design.md §3
-- ============================================

ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS is_shadow BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS train_until INT;   -- 학습 데이터 마지막 경주일 YYYYMMDD
ALTER TABLE model_versions DROP CONSTRAINT IF EXISTS chk_model_versions_active_not_shadow;
ALTER TABLE model_versions ADD CONSTRAINT chk_model_versions_active_not_shadow
  CHECK (NOT (is_active AND is_shadow));

CREATE TABLE IF NOT EXISTS shadow_predictions (
  race_date      INT          NOT NULL,
  meet           INT          NOT NULL,
  rc_no          INT          NOT NULL,
  hr_name        VARCHAR(50)  NOT NULL,
  model_version  INT          NOT NULL REFERENCES model_versions(id),
  total_score    NUMERIC      NOT NULL,
  predicted_rank INT          NOT NULL,
  p_top3         NUMERIC,
  actual_ord     INT,
  source         VARCHAR(10)  NOT NULL CHECK (source IN ('live', 'backfill')),
  computed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (race_date, meet, rc_no, hr_name, model_version)
);
CREATE INDEX IF NOT EXISTS idx_shadow_predictions_version_date
  ON shadow_predictions (model_version, race_date);

-- RLS (015_combo_dividends 관례): anon 읽기, 쓰기는 service_role만
ALTER TABLE shadow_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON shadow_predictions;
CREATE POLICY "anon_read" ON shadow_predictions FOR SELECT TO anon USING (true);

NOTIFY pgrst, 'reload schema';
