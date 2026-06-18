-- ============================================
-- 014_prediction_calibrated_probs.sql
-- predictions에 Platt 보정 확률 컬럼 추가 (Platt 라이브 연결, 설계 2026-06-19).
-- p_win  = 보정 우승확률 P(1착), p_top3 = 보정 연승확률 P(3착내).
-- nullable: 보정자 적재 전(calibration 없는 아티팩트) 예측은 NULL → UI graceful 미표시.
-- 순수 추가형(멱등). 랭킹·total_score·item_scores 불변.
-- ============================================

ALTER TABLE predictions ADD COLUMN IF NOT EXISTS p_win REAL;    -- 보정 우승확률 (0~1)
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS p_top3 REAL;   -- 보정 연승확률(3착내, 0~1)

NOTIFY pgrst, 'reload schema';
