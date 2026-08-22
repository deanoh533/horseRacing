-- ============================================
-- 017_races_entrysheet_columns.sql
-- races 스키마 드리프트 해소 — 출마표 전용 컬럼 3종을 마이그레이션에 편입
--
-- st_time·chaksun4·chaksun5는 출마표 sync(API26_2/entrySheet_2)가 채우는
-- 컬럼인데, 실 DB에는 수동으로 추가돼 있고 마이그레이션 파일에는 없었다.
-- (2026-08-23 점검에서 발견 — `supabase db reset` 시 컬럼이 사라져 재현 불가.)
--
-- 형식 메모: st_time은 KRA가 "출발 :10:35" 꼴 문자열로 준다(접두사 포함).
-- 2026-08-23 실측 17경주 전부 동일 형식이며 파싱 실패 0건. 경주 간격은
-- 25~80분으로 불규칙하므로 고정 주기를 가정하면 안 된다.
-- ============================================

ALTER TABLE races ADD COLUMN IF NOT EXISTS st_time  VARCHAR(20);  -- 발주 예정시각 "출발 :HH:MM"
ALTER TABLE races ADD COLUMN IF NOT EXISTS chaksun4 BIGINT;       -- 4착 상금
ALTER TABLE races ADD COLUMN IF NOT EXISTS chaksun5 BIGINT;       -- 5착 상금

COMMENT ON COLUMN races.st_time IS
  '발주 예정시각(출마표 API 원문, 예 "출발 :10:35"). 실제 발주시각은 KRA가 제공하지 않는다.';
