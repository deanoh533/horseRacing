# 🔧 KRA 공공데이터 API Quirks

**목적:** KRA 공공데이터 포털 API의 비표준 동작과 알려진 함정을 한 곳에 모음.
신규 endpoint 추가 시 동일한 검증 절차 (필드명, 응답 의미) 수행하기 위한 체크리스트.

---

## 활용 중인 endpoint 6개

| Endpoint | 용도 | 우리 경로 | 파라미터 형식 |
|---|---|---|---|
| `API214_1/RaceDetailResult_1` | 경주 결과 (말 단위) | [src/kra/client.ts](src/kra/client.ts) | `meet`, `rc_date` (snake_case) |
| `racedetailresult/getracedetailresult` | 결과 상세 (stOrd 등) | 동상 | `meet`, `rc_date`, `rc_no` |
| `API284/HorseBloodBasicInfo` | 혈통 지수 | 동상 | `hr_no` (그러나 **무시됨** — 아래 참조) |
| `horseinfohi/gethorseinfohi` | 말 정보 (부마/모마) | 동상 | **`hrno`** (camelCase 필수) |
| `API314/textDataHoldSePtinInfo` | 서울 출주표 | [src/sync/raceCardSync.ts](src/sync/raceCardSync.ts) | `race_dt`, `race_no` (snake_case, ⚠️ rc_date 아님) |
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

**적용:** [src/kra/client.ts](src/kra/client.ts) `getHorseInfo()` 가 `hrno` 사용.

---

### ⚠️ Quirk 3: 출주표 API 는 `race_dt`/`race_no` (snake_case)

**증상:** 다른 endpoint 와 달리 `rc_date`/`rc_no` 안 받음. 진짜 명세대로 `race_dt`/`race_no` 만 인식.

**검증:**
```
GET /API314/textDataHoldSePtinInfo?rc_date=20260524    → 403 Forbidden 또는 빈 응답
GET /API314/textDataHoldSePtinInfo?race_dt=20260524    → 정상 (11건)
```

**적용:** [src/sync/raceCardSync.ts](src/sync/raceCardSync.ts) 가 `race_dt`/`race_no` 사용.

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

**해결:** [src/engine/scorePredictor.ts](src/engine/scorePredictor.ts) 가 ⑫ starting_position 입력을 `chul_no` 로 변경. KRA 가 명세를 어떻게 정정할 때까지는 stOrd 필드 신뢰 X.

**상세:** [docs/score_items/12_starting_position.md](docs/score_items/12_starting_position.md)

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

## 변경 이력

| 일자 | 변경 |
|---|---|
| 2026-05-25 | 신규 작성. Quirk 1-5 정리 |
