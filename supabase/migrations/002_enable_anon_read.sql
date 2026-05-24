-- ============================================
-- 002_enable_anon_read.sql
-- 프론트엔드(anon 키)가 모든 데이터 테이블을 읽을 수 있도록 RLS 정책 추가
--
-- 개인용 앱 (1 사용자) → anon = 본인 = 모든 읽기 허용
-- 쓰기는 백엔드(service_role)만 수행 → anon 쓰기는 허용 안 함
-- ============================================

-- RLS 켜기 (이미 켜져 있으면 무시됨)
ALTER TABLE races            ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_results    ENABLE ROW LEVEL SECURITY;
ALTER TABLE horses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE jockeys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_insights    ENABLE ROW LEVEL SECURITY;
ALTER TABLE horse_insights   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs        ENABLE ROW LEVEL SECURITY;

-- 기존 정책 정리 (idempotent)
DROP POLICY IF EXISTS "anon_read"  ON races;
DROP POLICY IF EXISTS "anon_read"  ON horse_results;
DROP POLICY IF EXISTS "anon_read"  ON horses;
DROP POLICY IF EXISTS "anon_read"  ON jockeys;
DROP POLICY IF EXISTS "anon_read"  ON trainers;
DROP POLICY IF EXISTS "anon_read"  ON weight_history;
DROP POLICY IF EXISTS "anon_read"  ON predictions;
DROP POLICY IF EXISTS "anon_read"  ON race_insights;
DROP POLICY IF EXISTS "anon_read"  ON horse_insights;
DROP POLICY IF EXISTS "anon_read"  ON user_settings;
DROP POLICY IF EXISTS "anon_read"  ON ai_usage;
DROP POLICY IF EXISTS "anon_read"  ON sync_logs;

DROP POLICY IF EXISTS "anon_write_user_settings" ON user_settings;

-- ============================================
-- SELECT 정책 (anon 읽기 허용)
-- ============================================
CREATE POLICY "anon_read" ON races            FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON horse_results    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON horses           FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON jockeys          FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON trainers         FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON weight_history   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON predictions      FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON race_insights    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON horse_insights   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON user_settings    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON ai_usage         FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON sync_logs        FOR SELECT TO anon USING (true);

-- ============================================
-- user_settings는 UPDATE도 허용 (설정 화면에서 수정)
-- ============================================
CREATE POLICY "anon_write_user_settings" ON user_settings
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ============================================
-- 캐시 리로드 (PostgREST가 새 정책 인식하도록)
-- ============================================
NOTIFY pgrst, 'reload schema';
