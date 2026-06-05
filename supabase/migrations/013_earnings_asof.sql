-- ============================================
-- 013_earnings_asof.sql
-- API156 rsutRkPurse(경주별 상금) 저장 + as-of 누적 수득상금 컬럼.
-- 순수 추가형(멱등). erng_sump(오염 통산 스냅샷)은 보존(v1 동결).
-- ============================================

ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS rk_purse BIGINT;        -- 그 경주 획득 상금
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS erng_sump_asof BIGINT;  -- 그 경주 이전 누적(누수 없음)

NOTIFY pgrst, 'reload schema';
