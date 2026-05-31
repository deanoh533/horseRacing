-- ============================================
-- 009_drop_dead_tables.sql
-- race_cards · horse_results · sectional_records DROP
--
-- 배경:
--   - race_cards + horse_results → 004_race_entries.sql에서 race_entries로 통합됨
--   - sectional_records → API37_1 구독 미승인(403)으로 0 rows. API214_1이 동일 데이터 제공.
--
-- ⚠️ 주의: 이 마이그레이션은 비가역적입니다.
--   실행 전 race_cards·horse_results·sectional_records 행 수를 확인하세요:
--   SELECT relname, n_live_tup FROM pg_stat_user_tables
--   WHERE relname IN ('race_cards','horse_results','sectional_records');
-- ============================================

DROP TABLE IF EXISTS sectional_records CASCADE;
DROP TABLE IF EXISTS race_cards CASCADE;
DROP TABLE IF EXISTS horse_results CASCADE;
