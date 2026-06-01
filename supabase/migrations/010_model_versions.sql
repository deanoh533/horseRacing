-- ============================================
-- 010_model_versions.sql
-- 가중치/항목 버전관리 기반 (Stage A)
--
-- 목적:
--   - 점수엔진의 "버전"을 명시적으로 관리 (v1 동결 + 새 버전 승격/롤백)
--   - 항목 목록을 코드 상수(ITEM_NAMES/SCORE_ITEM_IDS)에서 DB로 일원화
--   - 예측에 "어느 버전으로 만들었나" 도장을 찍어 라이브 기록 동결
--
-- 설계 요약:
--   - score_items   : 항목 레지스트리 (정적 메타). active 컬럼 없음(활성=버전별 weight>0)
--   - model_versions: 가중치 벡터 버전 (append-only). is_active=현재 라이브
--   - predictions.model_version: 그 예측을 만든 버전 도장 (결과 확정 후 동결)
--
-- ⚠️ 순수 추가형 — 기존 데이터 손상 없음. 멱등(재실행 안전).
-- ============================================

-- --------------------------------------------
-- 1. score_items — 항목 레지스트리
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS score_items (
  item_id    VARCHAR(40) PRIMARY KEY,   -- 예: '06_distance_fitness'
  name       VARCHAR(40) NOT NULL,      -- 한국어 이름
  archived   BOOLEAN DEFAULT FALSE,     -- UI 힌트(영구 폐기 변형 숨김). 활성여부 아님
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- --------------------------------------------
-- 2. model_versions — 가중치 벡터 버전 (append-only)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS model_versions (
  id         SERIAL PRIMARY KEY,
  label      VARCHAR(20) UNIQUE NOT NULL,   -- 'v1', 'v2', ...
  weights    JSONB NOT NULL,                -- {item_id: weight}
  source     VARCHAR(20) NOT NULL DEFAULT 'manual', -- bootstrap | learned | manual
  is_active  BOOLEAN DEFAULT FALSE,         -- 현재 라이브 버전 (단 하나만 true)
  notes      TEXT,
  weight_history_id INT REFERENCES weight_history(id), -- 학습으로 만들어졌으면 출처 링크(선택)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 활성 버전은 최대 1개만 (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_versions_active
  ON model_versions (is_active) WHERE is_active;

-- --------------------------------------------
-- 3. predictions — 버전 도장 컬럼 추가
-- --------------------------------------------
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS model_version INT REFERENCES model_versions(id);

CREATE INDEX IF NOT EXISTS idx_predictions_version ON predictions(model_version);

-- --------------------------------------------
-- 4. RLS — anon 읽기 허용 (쓰기는 service_role)
-- --------------------------------------------
ALTER TABLE score_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read" ON score_items;
DROP POLICY IF EXISTS "anon_read" ON model_versions;

CREATE POLICY "anon_read" ON score_items    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON model_versions FOR SELECT TO anon USING (true);

-- --------------------------------------------
-- 5. Seed — 현재 21개 항목 (코드 ITEM_NAMES 기준)
-- --------------------------------------------
INSERT INTO score_items (item_id, name) VALUES
  ('01_rating',                 '레이팅'),
  ('02_weight_change',          '마체중 변화'),
  ('03_recent_form',            '착순 추세'),
  ('04_sectional_time',         '구간 시간 단축'),
  ('05_late_position',          '후반 구간 순위'),
  ('06_distance_fitness',       '거리 적성'),
  ('07_track_adaptation',       '주로 적응'),
  ('08_burden_weight',          '부담중량'),
  ('09_jockey_form',            '기수 폼'),
  ('09b_jockey_recent',         '기수 최근폼'),
  ('10_trainer_form',           '조교사 폼'),
  ('10b_trainer_recent',        '조교사 최근폼'),
  ('11_race_interval',          '경주 간격'),
  ('12_starting_position',      '출발번호'),
  ('13_age_distance_gender',    '나이×거리×성별'),
  ('14_pedigree',               '혈통'),
  ('15_seasonal_pattern',       '계절 패턴'),
  ('16_jockey_horse_chemistry', '기수-말 궁합'),
  ('17_market_odds',            '배당률'),
  ('18_earnings',               '수득상금'),
  ('19_running_style_pace',     '주행성향×페이스')
ON CONFLICT (item_id) DO NOTHING;

-- --------------------------------------------
-- 6. Seed — v1 기준선 (코드 ITEM_WEIGHTS 스냅샷, 2026-05-28)
-- --------------------------------------------
INSERT INTO model_versions (label, weights, source, is_active, notes) VALUES
  ('v1',
   '{
      "01_rating": 6.0,
      "02_weight_change": 0.5,
      "03_recent_form": 10.0,
      "04_sectional_time": 0,
      "05_late_position": 12.5,
      "06_distance_fitness": 24.0,
      "07_track_adaptation": 0,
      "08_burden_weight": 11.0,
      "09_jockey_form": 5.5,
      "09b_jockey_recent": 4.0,
      "10_trainer_form": 3.0,
      "10b_trainer_recent": 2.5,
      "11_race_interval": 3.0,
      "12_starting_position": 4.5,
      "13_age_distance_gender": 0,
      "14_pedigree": 3.0,
      "15_seasonal_pattern": 0.5,
      "16_jockey_horse_chemistry": 0.5,
      "17_market_odds": 3.0,
      "18_earnings": 3.0,
      "19_running_style_pace": 3.5
   }'::jsonb,
   'bootstrap', TRUE, 'ITEM_WEIGHTS 스냅샷(2026-05-28). v1 고정 기준선.')
ON CONFLICT (label) DO NOTHING;

-- --------------------------------------------
-- 7. 기존 예측을 v1로 도장 (지금 DB predictions = ITEM_WEIGHTS=v1로 생성됨)
-- --------------------------------------------
UPDATE predictions
   SET model_version = (SELECT id FROM model_versions WHERE label = 'v1')
 WHERE model_version IS NULL;

-- --------------------------------------------
-- 8. PostgREST 스키마 리로드
-- --------------------------------------------
NOTIFY pgrst, 'reload schema';
