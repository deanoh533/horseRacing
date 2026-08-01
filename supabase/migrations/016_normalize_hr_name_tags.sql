-- ============================================
-- 016_normalize_hr_name_tags.sql
-- 마명(hr_name) 지역 이적 태그 정규화 (데이터 백필, 스키마 변경 없음)
--
-- 문제: KRA API가 서울↔부산경남 이적마 이름 앞에 지역 태그를 붙이는데
--   표기가 일정하지 않다 — 같은 말(hr_no)이 경주에 따라
--   "벌교의꿈" / "[부산경남]벌교의꿈" / "[부]벌교의꿈" 세 가지로 저장됨.
--   hr_name은 과거전적·기수궁합·게이트통계·조교기록·예측매칭 등 프로젝트
--   전체에서 매칭 키로 쓰이므로, 표기가 갈리면 해당 말만 조용히 매칭이
--   끊긴다(에러 없이 그냥 결과가 비어 보임).
--
-- 조치: 세 테이블(race_entries·predictions·training_logs)의 hr_name에서
--   선행 "[...]" 태그를 제거해 항상 같은 값으로 통일. PK에 hr_name이
--   포함된 테이블이 없어 충돌 위험 없음(race_entries PK=pthr_no 기준,
--   predictions PK=id, training_logs PK=hr_no 기준).
--   재발 방지(코드): src/kra/client.ts에서 API 응답 즉시 stripHrNameTag 적용.
-- ============================================

UPDATE race_entries
SET hr_name = btrim(regexp_replace(hr_name, '^\[[^]]*\]', ''))
WHERE hr_name ~ '^\[';

UPDATE predictions
SET hr_name = btrim(regexp_replace(hr_name, '^\[[^]]*\]', ''))
WHERE hr_name ~ '^\[';

UPDATE training_logs
SET hr_name = btrim(regexp_replace(hr_name, '^\[[^]]*\]', ''))
WHERE hr_name ~ '^\[';
