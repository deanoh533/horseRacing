-- ============================================
-- 019_gate_tests.sql
-- 주행심사 결과 (마사회 홈페이지 전용 — 공공 API 없음)
--
-- scripts/gateTestSync.ts가 백필(날짜 훑기)·일일(목록 기반)로 멱등 upsert.
-- 값은 원문 보존(부담중량·도착차·주로상태). 해석은 피처 단계에서.
-- 스펙: docs/superpowers/specs/2026-10-05-gate-test-collection-design.md
-- ============================================

CREATE TABLE IF NOT EXISTS gate_tests (
  test_date      INT          NOT NULL,   -- 심사일 YYYYMMDD
  meet           INT          NOT NULL,   -- 1=서울, 3=부산경남
  trno           INT          NOT NULL,   -- 그날 회차 번호
  hr_no          VARCHAR(10)  NOT NULL,   -- race_entries.hr_no와 같은 형식
  hr_name        VARCHAR(50)  NOT NULL,
  rank           INT,
  gate_no        INT,
  reason         VARCHAR(40),             -- 심사사유 ('주행미합(신)', '장기휴양(재)' 등)
  origin         VARCHAR(20),
  sex            VARCHAR(4),
  age            INT,
  burden         VARCHAR(20),
  jockey         VARCHAR(30),
  trainer        VARCHAR(30),
  owner          VARCHAR(50),
  body_weight    INT,
  time_sec       NUMERIC,                 -- '1:03.4' → 63.4
  margin         VARCHAR(20),
  verdict        VARCHAR(20)  NOT NULL,   -- 합격·불합격·출전제외·출전취소·연습주행·연습취소
  verdict_reason VARCHAR(100),
  track_cond     VARCHAR(30),
  fetched_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (test_date, meet, trno, hr_no)
);

CREATE INDEX IF NOT EXISTS gate_tests_hr_no_idx ON gate_tests (hr_no, test_date);

-- RLS (015 관례): anon 읽기, 쓰기는 service_role만
ALTER TABLE gate_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON gate_tests;
CREATE POLICY "anon_read" ON gate_tests FOR SELECT TO anon USING (true);

NOTIFY pgrst, 'reload schema';
