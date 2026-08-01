# 🔧 KRA 공공데이터 API Quirks

**목적:** KRA 공공데이터 포털 API의 비표준 동작과 알려진 함정을 한 곳에 모음.
신규 endpoint 추가 시 동일한 검증 절차 (필드명, 응답 의미) 수행하기 위한 체크리스트.

---

## 활용 중인 endpoint 6개

| Endpoint | 용도 | 우리 경로 | 파라미터 형식 |
|---|---|---|---|
| `API214_1/RaceDetailResult_1` | 경주 결과 (말 단위) | [src/kra/client.ts](../src/kra/client.ts) | `meet`, `rc_date` (snake_case) |
| `racedetailresult/getracedetailresult` | 결과 상세 (stOrd 등) | 동상 | `meet`, `rc_date`, `rc_no` |
| `API284/HorseBloodBasicInfo` | 혈통 지수 | 동상 | `hr_no` (그러나 **무시됨** — 아래 참조) |
| `horseinfohi/gethorseinfohi` | 말 정보 (부마/모마) | 동상 | **`hrno`** (camelCase 필수) |
| `API314/textDataHoldSePtinInfo` | 서울 출주표 | [src/sync/raceCardSync.ts](../src/sync/raceCardSync.ts) | `race_dt`, `race_no` (snake_case, ⚠️ rc_date 아님) |
| `API316/textDataHoldBuPtinInfo` | 부산경남 출주표 | 동상 | 동상 |

---

## 알려진 함정

### ⚠️ Quirk 1: API284 의 `hr_no` 파라미터 무시됨

**증상:** 어떤 `hr_no` 값을 넣어도 totalCount=1135 (전체 말 목록)에서 첫 번째 행만 반환.

**검증:**
```
GET /API284/HorseBloodBasicInfo?serviceKey=...&hr_no=0047073
→ 항상 "대길대장 (0056674)" 반환

GET /API284/HorseBloodBasicInfo?serviceKey=...&hrno=0047073
→ totalCount=0 (없음)
```

**영향:** ⑭ 혈통 항목 데이터 사실상 수집 불가 → 현재 빈값 (`pedigree: {}`).

**해결 시도:**
- `hrno` (camelCase) → totalCount 0 (다른 의미)
- `hrName` → 같은 totalCount 1135 (필터 안 됨)
- KRA 포털 명세 추가 확인 필요. 우회: `horseinfohi` 로 sireHrnm/damHrnm 직접 수집 후 우리 알고리즘 자체적으로 부마 거리 패턴 통계 (scripts/analyze_sires.ts).

---

### ⚠️ Quirk 2: `horseinfohi` 는 `hrno` (camelCase)

**증상:** snake_case `hr_no` 보내면 첫 row만 반환 (필터 무시), camelCase `hrno` 보내야 진짜 해당 말 정보.

**검증:**
```
GET /horseinfohi/gethorseinfohi?hr_no=0047073    → totalCount=383, 첫 row 반환 (필터 X)
GET /horseinfohi/gethorseinfohi?hrno=0047073     → totalCount=1, 정확 매칭 (최강타임)
```

**적용:** [src/kra/client.ts](../src/kra/client.ts) `getHorseInfo()` 가 `hrno` 사용.

---

### ⚠️ Quirk 3: 출주표 API 는 `race_dt`/`race_no` (snake_case)

**증상:** 다른 endpoint 와 달리 `rc_date`/`rc_no` 안 받음. 진짜 명세대로 `race_dt`/`race_no` 만 인식.

**검증:**
```
GET /API314/textDataHoldSePtinInfo?rc_date=20260524    → 403 Forbidden 또는 빈 응답
GET /API314/textDataHoldSePtinInfo?race_dt=20260524    → 정상 (11건)
```

**적용:** [src/sync/raceCardSync.ts](../src/sync/raceCardSync.ts) 가 `race_dt`/`race_no` 사용.

---

### ⚠️ Quirk 4: 출주표는 사후 archive (미래 데이터 없음)

**증상:** 미래 날짜로 호출하면 totalCount=0. 출주표가 발표돼야 응답 받음.

**KRA 출주표 발표 패턴 (사용자 도메인 정보)**:
- 금요일 경기 → 수요일 발표
- 토요일 경기 → 목요일 발표 (즉 **약 2일 전**)

**진짜 운영 흐름**:
```
수~목  : npx tsx src/sync/raceCardSync.ts --date YYYYMMDD  (다음 금/토/일 출주표 → race_entries 사전 채움)
금~일  : predictRace → UI 사전 예측 표시 (race_entries.ord=null → 사전 모드 자동 분기)
일 밤  : npx tsx src/sync/dailySync.ts (결과 → race_entries UPDATE) + npm run backfill (predictions 재계산)
```

---

### ⚠️ Quirk 5 (Critical): stOrd 가 결승순위와 100% 동일 (cheating)

**증상:** racedetailresult API 의 `stOrd` 필드는 명세상 "출발 순위" 인데, 실측 결과 **항상 `ord` (결승순위)와 100% 동일**. 예측 입력으로 쓰면 정답을 미리 본 셈 (cheating).

**검증:**
- (구) `horse_results.st_ord` 와 `ord` 가 모든 row에서 동일 (995/995 = 100%) → race_entries 통합 시 st_ord 컬럼 제거됨.
- 출주표 API (API314) 의 `pthrNo` (진짜 출주마번호) 와 비교: pthrNo == `race_entries.pthr_no` (마구간 번호), `ord` 와 무관.

**영향:** 초기 측정 단승 26.9% 는 cheating 부풀림. 정직한 베이스라인은 23.8%.

**해결:** [src/engine/scorePredictor.ts](../src/engine/scorePredictor.ts) 가 ⑫ starting_position 입력을 `chul_no` 로 변경. KRA 가 명세를 어떻게 정정할 때까지는 stOrd 필드 신뢰 X.

**상세:** [docs/score_items/12_starting_position.md](score_items/12_starting_position.md)

---

## 신규 endpoint 추가 시 체크리스트

새 KRA API 붙이려면 매번 다음 검증:

1. ✅ **활용신청 됐는지** (data.go.kr 마이페이지) — 안 됐으면 403 Forbidden
2. ✅ **파라미터 케이스** — `hr_no` vs `hrno`, `rc_date` vs `race_dt` 시도
3. ✅ **필터 동작 여부** — `totalCount` 가 의도한 1 또는 N 인지 (전체 dataset 크기면 무시됨)
4. ✅ **응답 필드명** — KRA 명세와 실제 응답이 다를 수 있음 (예: stOrd 라 적혀있지만 사실 ord)
5. ✅ **미래/과거 데이터 범위** — 일부 endpoint 는 사후 archive 만
6. ✅ **일일 호출 한도** — 보통 1,000회. 한도 도달 시 429 또는 LIMITED_NUMBER 오류

---

---

### ℹ️ Quirk 6: API6_1/raceDetailSectionRecord_1 — 경주 단위 페이스 데이터 (말별 X)

**발견:** 2026-05-30 `probe_api6_1_section.ts` 실행

**응답 구조:** 경주 1건 = 1 row (말별 row X)

| 필드 | 예시 (서울 1200m) | 의미 |
|---|---|---|
| `time_1f`~`time_6f` | 13.7, 11.3, 11.9, 13.0, 12.3, 13.5 | 각 200m 구간 스플릿 (초) |
| `passtime_1f`~`passtime_6f` | 13.7, 25.0, 36.9, 49.9, 62.2, 75.7 | 누적 통과 시간 (초) |
| `passrankS1f` | `"(1,2,4,^11),(6,10),(3,8),5,7,9"` | 출발 200m 그룹 통과 순위 문자열 |
| `passrankG3f_4c` | `"(1,2,4),(8,7),(6,5),3-(9,10)≡11"` | 4코너/g3f 통과 순위 문자열 |
| `passrankG1f` | `"7,4-(2,5)-9,1,(8,6)-10,3≡11"` | g1f 통과 순위 문자열 |

**주의사항:**
- `passrank*` 필드는 전체 말의 그룹 순위 문자열 — 개별 말 순위 파싱이 복잡함
- 부경 (meet=3) → totalCount=0, 응답 없음 (서울 전용으로 보임)
- `time_1f`~`time_Nf` 는 실제 퍼롱별 페이스 계산에 유용 (⑲ 주행성향×페이스 재설계 시 활용 예정)

**활성화 조건:** data.go.kr에서 API6_1 개별 신청 필요 (현재 API6_1 오퍼레이션 이름 8개 후보 전부 404 — `raceDetailSectionRecord_1`만 유효)

---

### ℹ️ Quirk 7: ratg=0 은 KRA 원천 데이터 없음 — 보완 불가

**발견:** 2026-05-30 `probe_rating_apis.ts` 실행

**세 API의 ratg 반환 패턴:**

| API | ratg>0 말 | ratg=0 말 |
|---|---|---|
| API214_1 (결과) | 정확히 반환 | 0 |
| API26_2 (새카드) | 정확히 반환 | 0 또는 `-` |
| API314/316 (구카드) | **항상 0** | 0 |

**결론:**
- `ratg=0` 또는 null → KRA가 해당 말에 등급포인트를 부여하지 않은 것 (주로 국6등급 신마). 보완 불가.
- `API314/316`은 ratg를 항상 0으로 반환 — ratg 소스로 쓰면 안 됨.
- `raceCardSync`는 `API26_2` → `toRaceEntryRowFromEntrySheet()` 경로로 ratg를 정상 저장 중 (이상 없음).

---

---

### ℹ️ Quirk 8: API4_3/raceResult_3 — API214_1과 거의 동일, 교체 불필요

**발견:** 2026-05-30 `probe_compare_apis.ts` 실행 (필드 수 직접 비교)

| 항목 | API214_1 | API4_3 |
|---|---|---|
| 필드 수 | 90 | 89 |
| API4_3에만 있는 필드 | — | `hrNameEn`, `jkNameEn`, `owNameEn`, `trNameEn`, `sexCond` (영문명 + 성별조건) |
| API214_1에만 있는 필드 | `wgJk`(기수체중), `birthday`, `ordBigo`, `rankRise`, `hrTool`, `wgBudamBigo` | — |

**결론:**
- API4_3는 영문명 4개 + sexCond 추가 대신 `wgJk`(기수체중) 등 6개를 빠뜨림
- **API214_1이 더 유리** → 교체 불필요
- `wgHr`, `winOdds`, `plcOdds`, `track`, `weather`, `se_1cAccTime`, `sj_1cOrd` 등은 API214_1도 이미 반환함

**부경 구간 개별 타임 수집:** 2026-05-30 완료
- `bu_s1fTime`, `bu_1fGTime`~`bu_10_8fTime` 8개 필드 race_entries에 추가
- transformer.ts + dailySync.ts 반영, backfill 완료

---

### ⚠️ Quirk 9 (Critical): `hrName`에 지역 이적 태그가 비일관적으로 붙음

**증상:** 서울↔부산경남을 이적한 말의 이름 앞에 KRA가 지역 태그를 붙이는데,
표기가 시점마다 다르다 — 같은 말(`hr_no`)인데 경주별로 `hr_name`이 3가지로 갈림:
```
"벌교의꿈"            (태그 없음)
"[부산경남]벌교의꿈"  (전체 지역명)
"[부]벌교의꿈"        (축약형)
```

**왜 치명적인가:** `hr_name`은 이 프로젝트 전체에서 말을 매칭하는 키다 — 과거전적
(`useHorseHistory`), 기수-말 궁합(`useJockeyHorseComboBatch`), 게이트별 성적
(`useHorseGateStatsBatch`), 조교 기록(`useTrainingBatchByNames`), 예측 매칭
(`predictions.hr_name`) 등. 표기가 갈리면 그 말만 **에러 없이 조용히** 매칭이
끊긴다(과거 기록이 있는데 "기록 없음"으로 보임).

**발견:** 2026-08-01, `race_entries.hr_name ILIKE '%부산경남%'` 조회 중 사용자가
화면에서 "[부산경남]" 표기를 목격 → 조사 결과 118마리에서 hr_name 불일치 확인
(219행 `[부산경남]`, 129행 `[부]`, 나머지는 태그 없음).

**조치:**
- **재발 방지(코드):** `src/kra/client.ts`의 `getRaceResults`·`getEntrySheet`·
  `getTrainingHistory`(+`getAllTrainingHistory`)가 API 응답을 받는 즉시
  `stripHrNameTag()`(`src/utils/parsers.ts`)로 선행 `[...]` 태그 제거 후 반환.
  이 세 지점이 `hr_name`이 시스템에 들어오는 유일한 입구라 여기서 한 번만
  정규화하면 이후 전 파이프라인이 항상 깨끗한 값을 본다.
- **기존 데이터 백필:** `supabase/migrations/016_normalize_hr_name_tags.sql` —
  `race_entries`·`predictions`·`training_logs` 세 테이블(hr_name PK 아님,
  충돌 위험 없음)의 기존 태그 제거. 사용자가 Supabase SQL Editor에서 직접 실행.
- **범위 밖:** `horses` 테이블도 `hr_name` 컬럼이 있으나 모든 쿼리가 `hr_no`로만
  매칭해 이 버그의 영향을 안 받음 — 백필 대상에서 제외.

---

## 변경 이력

| 일자 | 변경 |
|---|---|
| 2026-05-25 | 신규 작성. Quirk 1-5 정리 |
| 2026-05-30 | Quirk 6(API6_1 페이스 데이터), Quirk 7(ratg=0 구조적 공백), Quirk 8(API4_3 비교) 추가 |
| 2026-08-01 | Quirk 9(hrName 지역 이적 태그 비일관 — hr_name 매칭 끊김 버그) 추가 |
