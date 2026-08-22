# API 명세서

> 작성일: 2026-05-31  
> 대상: KRA 공공데이터 포털 API · Supabase · Anthropic Claude API  
> 소스: `src/kra/client.ts`, `client/src/lib/queries.ts`, `client/src/lib/supabase.ts`
>
> 🔧 **유지보수 규칙:** 이 문서는 **API 명세 단일 출처(SSOT)**다. KRA·Supabase·Claude API의 엔드포인트·파라미터·응답필드·테이블/뷰 스키마·React Query 훅이 바뀌면 **변경과 함께 이 문서를 갱신**한다.

---

## 목차

1. [KRA 공공데이터 포털 API](#1-kra-공공데이터-포털-api)
2. [Supabase API (데이터베이스)](#2-supabase-api-데이터베이스)
3. [Anthropic Claude API](#3-anthropic-claude-api)
4. [공통 사항](#4-공통-사항)

---

## 1. KRA 공공데이터 포털 API

### 기본 정보

| 항목 | 값 |
|------|---|
| Base URL | `https://apis.data.go.kr/B551015` |
| 인증 방식 | Query param `serviceKey` (환경변수 `KRA_API_KEY`) |
| 응답 포맷 | JSON (`_type=json` 필수) |
| 타임아웃 | 30초 |
| 동시 요청 제한 | 5개 (p-limit) |
| 클라이언트 파일 | `src/kra/client.ts` (`KRAClient` 클래스) |

### 공통 응답 구조

```json
{
  "response": {
    "header": {
      "resultCode": "00",
      "resultMsg": "NORMAL SERVICE"
    },
    "body": {
      "items": { "item": [...] },
      "numOfRows": 100,
      "pageNo": 1,
      "totalCount": 42
    }
  }
}
```

`resultCode !== "00"` 이면 에러로 처리.  
`items.item`이 단건이면 객체, 다건이면 배열로 반환됨 (`parseResponse()` 내부 정규화).

### 경마장 코드 (MeetCode)

| 값 | 경마장 |
|----|--------|
| `1` | 서울 |
| `2` | 제주 |
| `3` | 부산경남 |

---

### 1.1 API214_1 — 경주 결과 (말 단위)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /API214_1/RaceDetailResult_1` |
| 용도 | 경주 결과 수집 (말 단위, 구간기록 포함) |
| 클라이언트 메서드 | `getRaceResults()` / `getAllRaceResults()` |
| 호출 파일 | `src/kra/client.ts:82` |
| 상태 | ✅ 활성 |

**요청 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `serviceKey` | string | ✅ | API 키 |
| `meet` | number | ✅ | 경마장 코드 (1/2/3) |
| `rc_date` | number | ✅ | 경주 날짜 (YYYYMMDD) |
| `pageNo` | number | - | 페이지 번호 (기본 1) |
| `numOfRows` | number | - | 페이지 크기 (기본 100) |
| `_type` | string | ✅ | `"json"` 고정 |

**응답 주요 필드 (`KRARaceResult`)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `rcDate` | number | 경주 날짜 |
| `rcNo` | number | 경주 번호 |
| `hrNo` | string | 말 번호 |
| `hrName` | string | 말 이름 |
| `ord` | number | 최종 착순 |
| `rcDist` | number | 경주 거리 (m) |
| `track` | string | 주로 (잔디/모래) |
| `weather` | string | 날씨 |
| `rcTime` | number | 기록 (초) |
| `burdWgt` | number | 부담중량 |
| `wgHr` | number | 말 실측체중 |
| `winOdds` | number | 단승 배당률 |
| `popularity` | number | 인기순위 |
| `jckyNo` | string | 기수 번호 |
| `jckyNm` | string | 기수 이름 |
| `trarNm` | string | 조교사 이름 |
| — 서울 구간기록 — | | |
| `seG1fAccTime` | number | 서울 G1f 누적시간 (초) |
| `seG3fAccTime` | number | 서울 G3f 누적시간 |
| `seS1fAccTime` | number | 서울 S1f 누적시간 |
| `se3cAccTime` | number | 서울 3코너 누적시간 |
| `se4cAccTime` | number | 서울 4코너 누적시간 |
| `sjG1fOrd` | number | 서울 G1f 순위 |
| `sjG3fOrd` | number | 서울 G3f 순위 |
| `sjS1fOrd` | number | 서울 S1f 순위 |
| `sj3cOrd` | number | 서울 3코너 순위 |
| `sj4cOrd` | number | 서울 4코너 순위 |
| — 부경 구간기록 — | | |
| `buG1fAccTime` | number | 부경 G1f 누적시간 |
| `buG2fAccTime` | number | 부경 G2f 누적시간 |
| `buG3fAccTime` | number | 부경 G3f 누적시간 |
| `buG4fAccTime` | number | 부경 G4f 누적시간 |
| `buG6fAccTime` | number | 부경 G6f 누적시간 |
| `buG8fAccTime` | number | 부경 G8f 누적시간 |
| `buS1fAccTime` | number | 부경 S1f 누적시간 |
| `buG1fOrd` | number | 부경 G1f 순위 |
| `buG2fOrd` | number | 부경 G2f 순위 |
| `buG3fOrd` | number | 부경 G3f 순위 |
| `buG4fOrd` | number | 부경 G4f 순위 |
| `buS1fOrd` | number | 부경 S1f 순위 |

> **참고:** 부경 G5f/G6f/G7f/G8f 순위 컬럼은 KRA API 미제공 (구조적 공백).

---

### 1.2 racedetailresult — 경주 상세 결과 (stOrd 포함)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /racedetailresult/getracedetailresult` |
| 용도 | `stOrd` (출발 순위) 포함 상세 결과 |
| 클라이언트 메서드 | `getRaceDetailResult()` |
| 호출 파일 | `src/kra/client.ts:136` |
| 상태 | ✅ 활성 |

> ⚠️ **Quirk:** `stOrd`는 명세상 "출발 순위"이나 실측 결과 `ord`(최종 착순)와 100% 동일. 예측 입력으로 사용 시 정답 유출 위험 → 실제 게이트 번호는 `pthr_no`(= `chul_no`) 사용.

**요청 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `serviceKey` | string | ✅ | API 키 |
| `meet` | number | ✅ | 경마장 코드 |
| `rc_date` | number | ✅ | 날짜 (YYYYMMDD) |
| `rc_no` | number | ✅ | 경주 번호 |
| `pageNo` | number | - | 기본 1 |
| `numOfRows` | number | - | 기본 50 |

**응답 주요 필드 (`KRARaceDetail`)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `stOrd` | number | ⚠️ 출발 순위 (실측상 최종 착순과 동일) |
| `ord` | number | 최종 착순 |

---

### 1.3 API26_2 — 출전표 상세 (현재 권장)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /API26_2/entrySheet_2` |
| 용도 | 경주 전 출전표 수집 (날짜 단위 일괄) |
| 클라이언트 메서드 | `getEntrySheet()` / `getAllEntrySheet()` |
| 호출 파일 | `src/kra/client.ts:219` |
| 상태 | ✅ 활성 (권장) — API314/316 대체 |

**요청 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `serviceKey` | string | ✅ | API 키 |
| `meet` | number | ✅ | 경마장 코드 |
| `rc_date` | number | ✅ | 날짜 (YYYYMMDD) |
| `pageNo` | number | - | 기본 1 |
| `numOfRows` | number | - | 기본 100 |

**응답 주요 필드 (`KRAEntrySheetItem`)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `rcDate` | number | 경주 날짜 |
| `rcNo` | number | 경주 번호 |
| `rcName` | string | 경주명 |
| `rcDist` | number | 거리 (m) |
| `rcDay` | string | 요일 |
| `chulNo` | number | 출주번호 = 게이트 번호 (PK의 일부) |
| `hrName` | string | 말 이름 |
| `hrNo` | string | 말 번호 |
| `age` | number | 연령 |
| `sex` | string | 성별 |
| `prd` | string | 산지 |
| `wgBudam` | number | 부담중량 |
| `rating` | number\|string | 레이팅 (미등급이면 `"-"`) |
| `rank` | string | 등급 (예: `"국6등급"`) |
| `prizeCond` | string | 조건 (예: `"국내산계"`) |
| `ageCond` | string | 연령 조건 |
| `sexCond` | string | 성별 조건 |
| `jkName` | string | 기수 이름 |
| `jkNo` | string | 기수 번호 |
| `trName` | string | 조교사 이름 |
| `trNo` | string | 조교사 번호 |
| `owName` | string | 마주 이름 |
| `stTime` | string | 출발 예정 시각 (예: `"출발 :10:45"`) |
| `dusu` | number | 출전 두수 |
| `chaksunT` | number | 통산 수득상금 (= `erng_sump`) |
| `chaksunY` | number | 금년 수득상금 (= `erng_loy`) |
| `chaksun6m` | number | 최근 6개월 수득상금 (= `erng_lsm`) |
| `ord1CntT` | number | 통산 1착 횟수 |
| `ord1CntY` | number | 금년 1착 횟수 |
| `ord2CntT` | number | 통산 2착 횟수 |
| `ord3CntT` | number | 통산 3착 횟수 |
| `rcCntT` | number | 통산 출전수 |
| `rcCntY` | number | 금년 출전수 |
| `asisEquip1`~`5` | string | 장구 |
| `latstBledg1`~`2` | string | 최근 출혈 |
| `latstTrea1Txt`~`2` | string | 최근 진료 내역 |

---

### 1.4 API18_1 — 일별 훈련 정보

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /API18_1/dailyTraining_1` |
| 용도 | 말별 일별 조교 기록 수집 |
| 클라이언트 메서드 | `getTrainingHistory()` / `getAllTrainingHistory()` |
| 호출 파일 | `src/kra/client.ts:329` |
| 상태 | ✅ 활성 (실제 응답 검증됨) |

**요청 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `serviceKey` | string | ✅ | API 키 |
| `meet` | number | ✅ | 경마장 코드 |
| `tr_date` | number | ✅ | 훈련 날짜 (YYYYMMDD) |
| `hr_no` | string | - | 말 번호 (생략 시 해당 날 전체) |
| `pageNo` | number | - | 기본 1 |
| `numOfRows` | number | - | 기본 100 |

**응답 주요 필드 (`KRATrainingRecord`)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `trDate` | number | 훈련 날짜 (YYYYMMDD) |
| `meet` | string | 경마장명 (`"서울"` / `"부산경남"`) |
| `hrNo` | string | 말 번호 |
| `hrName` | string | 말 이름 |
| `trName` | string | 조교사 이름 |
| `part` | number | 조교 회차 |
| `partNo` | number | 조 번호 |
| `chulGubun` | string | 출전 구분 (`"금주출전예정"` / `"-"` 등) |
| `prGubun` | string | 조교 구분 (이름=기수, 조=조교사, 관=주로조교, 생=교육생) |
| `prNo` | string | 조교 번호 |
| `run1Cnt` | number | 1차 달린 횟수 |
| `run2Cnt` | number | 2차 달린 횟수 |
| `stTime` | number | 시작 시각 (YYYYMMDDHHmmss) |
| `spTime` | number | 종료 시각 (YYYYMMDDHHmmss) |
| `trTerm` | number | 조교 소요 시간 (초) — 실제 속도 계산에 사용 |

> **주의:** `stTime`/`spTime`은 타임스탬프(YYYYMMDDHHmmss). 실제 소요 시간은 `trTerm`(초) 사용.

---

### 1.5 jkpresult — 기수 통산 성적

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /jkpresult/getjkpresult` |
| 용도 | 기수 통산 단승률/입상률 수집 |
| 클라이언트 메서드 | `getJockeyStats()` |
| 호출 파일 | `src/kra/client.ts:399` |
| 상태 | ✅ 활성 (이미 구독됨) |

**요청 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `serviceKey` | string | ✅ | API 키 |
| `meet` | number | ✅ | 경마장 코드 (1 또는 3) |
| `jk_no` | string | - | 기수 번호 (생략 시 해당 경마장 전체) |
| `pageNo` | number | - | 기본 1 |
| `numOfRows` | number | - | 기본 100 |

**응답 주요 필드 (`KRAJockeyStat`)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `meet` | number | 경마장 코드 (1=서울, 3=부산경남) |
| `jkNo` | string | 기수 번호 |
| `jkName` | string | 기수 이름 |
| `raceCnttsum` | number | 통산 출주 수 |
| `firstCnt` | number | 통산 1위 횟수 |
| `secondCnt` | number | 통산 2위 횟수 |
| `thirdCnt` | number | 통산 3위 횟수 |
| `winRateTsum` | number | 통산 단승률 (%) |
| `quRateTsum` | number | 통산 입상률 (%) |

---

### 1.6 horseinfohi — 말 정보 (부마/모마)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /horseinfohi/gethorseinfohi` |
| 용도 | 말의 부마·모마·기본 정보 수집 |
| 클라이언트 메서드 | `getHorseInfo()` |
| 호출 파일 | `src/kra/client.ts:187` |
| 상태 | ✅ 활성 |

> ⚠️ **Quirk:** 말 번호 파라미터가 `hrno` (camelCase). `hr_no`(snake_case)로 요청하면 필터 무시 → 전체 반환.

**요청 파라미터**

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `serviceKey` | string | ✅ | API 키 |
| `hrno` | string | △ | 말 번호 (**camelCase** 필수) |
| `hr_name` | string | △ | 말 이름 (`hrno` 없을 때 대체) |

**응답 주요 필드 (`KRAHorseInfo`)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `hrNo` | string | 말 번호 |
| `hrName` | string | 말 이름 |
| `engHrName` | string | 영문 말 이름 |
| `birthday` | number | 생년월일 |
| `sireHrnm` | string | 부마 이름 |
| `damHrnm` | string | 모마 이름 |

---

### 1.7 API284 — 혈통 지수 (사실상 불동)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /API284/HorseBloodBasicInfo` |
| 용도 | 혈통 능력 지수 수집 |
| 클라이언트 메서드 | `getBloodInfo()` |
| 호출 파일 | `src/kra/client.ts:163` |
| 상태 | ⚠️ 활성 코드 있으나 사실상 불동 |

> ⚠️ **Quirk (심각):** `hr_no` 파라미터가 완전히 무시됨. 항상 첫 번째 말("대길대장 #0056674")의 데이터 반환. `totalCount=1135` (전체 DB). 혈통 지수 수집 불가 → `pedigree: {}` 빈값 처리.

---

### 1.8 API314/316 — 구 출전표 (deprecated)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /API314/textDataHoldSePtinInfo` (서울) |
| | `GET /API316/textDataHoldBuPtinInfo` (부경) |
| 용도 | 경주별 출전표 (구형) |
| 클라이언트 메서드 | `getRaceCard()` |
| 호출 파일 | `src/kra/client.ts:268` |
| 상태 | ❌ **deprecated** — `API26_2`로 대체 |

> ⚠️ **Quirk:** 파라미터가 `race_dt` / `race_no` (snake_case, 날짜 형식도 다름). `rc_date` 사용 시 403 반환.  
> ⚠️ **Quirk:** `ratg` 필드가 항상 0 반환 (레이팅 데이터 없음).

---

### 1.9 API37_1 — 구간 통과기록 (구독 필요)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /API37_1/sectionRecord_1` |
| 용도 | 경주별 구간 통과기록 |
| 클라이언트 메서드 | `getSectionalRecords()` |
| 상태 | 🔒 **403 Forbidden** — 별도 구독 필요 |

> **참고:** `API214_1` 응답에 서울·부경 구간기록이 이미 포함되어 있어 별도 구독 없이도 구간 데이터 활용 가능.

---

### 1.10 API160_1 — 경주 단위 통합배당 정보 (조합 확정배당)

| 항목 | 값 |
|------|---|
| 엔드포인트 | `GET /API160_1/integratedInfo_1` |
| 용도 | 조합 확정배당 조회 (복승식·복연승식·쌍승식·삼복승식·삼쌍승식 등 모든 pool) |
| 파라미터 | `meet, rc_date, rc_no, pageNo, numOfRows, _type` |
| 반환 필드 | `pool`(조합 종류), `chulNo`(leg1), `chulNo2`(leg2), `chulNo3`(leg3, 3마리 조합 아니면 0/부재), `odds`(확정배당) |
| 클라이언트 메서드 | `getComboDividends()` |
| 호출 파일 | `src/kra/client.ts:477` |
| 상태 | ✅ 사용 중 — 결과 sync(`dailySync`)가 경주 결과 저장 직후 호출, 대상 pool만 `combo_dividends`에 upsert (2026-07-29) |

> ⚠️ **Quirk:** `pool` 입력 필터가 API에 전달돼도 무시됨 — 전체 pool을 받아 호출부에서 필터. 단승/연승은 이미 `race_entries`에 있어 여기서는 저장하지 않음.

---

## 2. Supabase API (데이터베이스)

### 기본 정보

| 항목 | 값 |
|------|---|
| Project URL | `https://njyfncqwuxjumupaijyc.supabase.co` |
| 프론트엔드 키 | `VITE_SUPABASE_ANON_KEY` (RLS 보호) |
| 백엔드 키 | `SUPABASE_SERVICE_ROLE_KEY` (RLS 우회) |
| SDK | `@supabase/supabase-js` |
| 프론트 클라이언트 | `client/src/lib/supabase.ts` |
| 백엔드 클라이언트 | `src/db/supabase.ts` |

---

### 2.1 테이블 스키마

#### `races` — 경주 메타

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `race_date` | number | 경주 날짜 (PK의 일부) |
| `meet` | number | 경마장 코드 (PK의 일부) |
| `rc_no` | number | 경주 번호 (PK의 일부) |
| `rc_dist` | number\|null | 경주 거리 (m) |
| `rc_name` | string\|null | 경주명 |
| `rc_day` | string\|null | 요일 |
| `track` | string\|null | 주로 |
| `track_type` | string\|null | 주로 타입 (모래/잔디) |
| `weather` | string\|null | 날씨 |
| `age_cond` | string\|null | 연령 조건 |
| `prize_cond` | string\|null | 조건 (등급) |
| `chaksun1`~`3` | number\|null | 1·2·3착 상금 |
| `chaksun4`~`5` | number\|null | 4·5착 상금 — **출마표 sync만 채움** |
| `st_time` | string\|null | 발주 예정시각, KRA 원문 `"출발 :10:35"` — **출마표 sync만 채움** |

> ⚠️ `st_time`·`chaksun4`·`chaksun5`는 출마표 API(API26_2)에만 있고 결과 API(API214_1)엔 없다. 결과 sync의 `toRaceRow()`는 이 세 컬럼을 **반환 객체에서 빼서** upsert가 기존 값을 보존하게 한다(넣으면 NULL로 덮인다 — 2026-08-23 수정). 실제 발주시각(지연 반영)은 KRA가 제공하지 않는다. 경주 간격은 25~80분으로 불규칙.

#### `race_entries` — 출전마 (사전+사후 통합, PK)

PK: `(race_date, meet, rc_no, pthr_no)`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `race_date` | number | 경주 날짜 |
| `meet` | number | 경마장 코드 |
| `rc_no` | number | 경주 번호 |
| `pthr_no` | number | 게이트 번호 (= `chul_no`) |
| `hr_name` | string | 말 이름 |
| `ag` | number\|null | 연령 |
| `gndr` | string\|null | 성별 |
| `burd_wgt` | number\|null | 부담중량 |
| `ratg` | number\|null | 레이팅 |
| `rank_str` | string\|null | 한글 등급 (예: `"국6등급"`) |
| `jcky_no` | string\|null | 기수 번호 |
| `jcky_nm` | string\|null | 기수 이름 |
| `trar_no` | string\|null | 조교사 번호 |
| `trar_nm` | string\|null | 조교사 이름 |
| `erng_sump` | number\|null | 수득상금 통산 |
| `erng_loy` | number\|null | 수득상금 최근 1년 |
| `erng_lsm` | number\|null | 수득상금 최근 6개월 |
| `prds` | string\|null | 출생지 |
| `owner_nm` | string\|null | 마주 |
| `sump_rcod_fplc` | number\|null | 통산 1위 횟수 |
| `sump_rcod_splc` | number\|null | 통산 2위 횟수 |
| `sump_rcod_tplc` | number\|null | 통산 3위 횟수 |
| `sump_rcod_sum` | number\|null | 통산 출주 수 |
| `rc_dist` | number\|null | 경주 거리 (사후 채워짐) |
| `track_type` | string\|null | 주로 타입 (사후 채워짐) |
| `hr_no` | string\|null | 말 번호 (사후 채워짐) |
| `ord` | number\|null | **최종 착순** (경기 전=null) |
| `rc_time` | number\|null | 기록 (초) |
| `wg_hr` | number\|null | 말 실측체중 |
| `wg_hr_diff` | number\|null | 전 경주 대비 체중 변화 |
| `wg_jk` | number\|null | 기수 체중 |
| `win_odds` | number\|null | 단승 배당률 |
| `popularity` | number\|null | 인기순위 |
| `result_at` | string\|null | 결과 수집 시각 |
| `asis_equip1`~`5` | string\|null | 장구 |
| `latst_bledg1`~`2` | string\|null | 최근 출혈 |
| `latst_trea1_txt`~`2` | string\|null | 최근 진료 내역 |
| — 서울 구간기록 — | | |
| `se_g1f_acc_time` | number\|null | G1f 누적시간 (초) |
| `se_g3f_acc_time` | number\|null | G3f 누적시간 |
| `se_s1f_acc_time` | number\|null | S1f 누적시간 |
| `se_1c`~`4c_acc_time` | number\|null | 1~4코너 누적시간 |
| `sj_g1f_ord` | number\|null | G1f 순위 |
| `sj_g3f_ord` | number\|null | G3f 순위 |
| `sj_s1f_ord` | number\|null | S1f 순위 |
| `sj_1c`~`4c_ord` | number\|null | 1~4코너 순위 |
| — 부경 구간기록 — | | |
| `bu_g1f_acc_time`~`bu_g8f_acc_time` | number\|null | G1f~G8f 누적시간 |
| `bu_s1f_acc_time` | number\|null | S1f 누적시간 |
| `bu_g1f_ord`~`bu_g4f_ord` | number\|null | G1f~G4f 순위 |
| `bu_s1f_ord` | number\|null | S1f 순위 |
| — 부경 개별 구간 타임 (신규 2026-05-30) — | | |
| `bu_s1f_time` | number\|null | S1f 개별 구간 타임 |
| `bu_1fg_time`~`bu_10_8f_time` | number\|null | 각 구간 개별 타임 (8개) |

#### `predictions` — 예측 결과

PK: `(race_date, meet, rc_no, hr_name)`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `race_date` | number | 경주 날짜 |
| `meet` | number | 경마장 코드 |
| `rc_no` | number | 경주 번호 |
| `hr_name` | string | 말 이름 |
| `total_score` | number | 종합 점수 |
| `predicted_rank` | number | 예측 순위 |
| `item_scores` | JSON | 항목별 세부 점수 (`ItemScore[]`) |
| `actual_ord` | number\|null | 실제 착순 (경기 후 채워짐) |

#### `training_logs` — 훈련 기록

PK: `(train_date, meet, hr_no, part)`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `train_date` | number | 훈련 날짜 (YYYYMMDD) |
| `meet` | number | 경마장 코드 |
| `hr_no` | string | 말 번호 |
| `part` | number | 조교 회차 |
| `hr_name` | string\|null | 말 이름 |
| `trar_nm` | string\|null | 조교사 이름 |
| `part_no` | number\|null | 조 번호 |
| `chul_gubun` | string\|null | 출전 구분 |
| `pr_gubun` | string\|null | 기승자 구분 |
| `pr_no` | string\|null | 기승자 번호 |
| `run1_cnt` | number\|null | 1차 달린 횟수 |
| `run2_cnt` | number\|null | 2차 달린 횟수 |
| `st_time` | number\|null | 시작 시각 (YYYYMMDDHHmmss) |
| `sp_time` | number\|null | 종료 시각 (YYYYMMDDHHmmss) |
| `tr_term` | number\|null | 소요 시간 (초) |
| `fetched_at` | string\|null | 수집 시각 |

#### `jockey_stats` — 기수 통산 성적

PK: `(jcky_no, meet)`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `jcky_no` | string | 기수 번호 |
| `meet` | number | 경마장 코드 |
| `jcky_nm` | string\|null | 기수 이름 |
| `race_cnt_t` | number\|null | 통산 출주 수 |
| `first_cnt` | number\|null | 통산 1위 횟수 |
| `second_cnt` | number\|null | 통산 2위 횟수 |
| `third_cnt` | number\|null | 통산 3위 횟수 |
| `win_rate_t` | number\|null | 통산 단승률 (%) |
| `qu_rate_t` | number\|null | 통산 입상률 (%) |
| `updated_at` | string\|null | 마지막 업데이트 시각 |

#### `horses` — 말 정적 정보

PK: `hr_no`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `hr_no` | string | 말 번호 |
| `hr_name` | string | 말 이름 |
| `eng_hr_name` | string\|null | 영문 이름 |
| `birthday` | number\|null | 생년월일 |
| `sex` | string\|null | 성별 |
| `pcty_nm` | string\|null | 산지 |
| `spcs_nm` | string\|null | 품종 |
| `sire_hr_nm` | string\|null | 부마 이름 |
| `dam_hr_nm` | string\|null | 모마 이름 |
| `dam_sire_hr_nm` | string\|null | 모부마 이름 |
| `dsa_bri_vl` | number\|null | 혈통 지수 (번식) |
| `dsa_clc_vl` | number\|null | 혈통 지수 (성적) |
| `last_updated` | string\|null | 마지막 업데이트 |

#### `weight_history` — 가중치 학습 이력

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | number | PK |
| `period_start` | string | 학습 기간 시작 (YYYY-MM-DD) |
| `period_end` | string | 학습 기간 종료 |
| `race_count` | number | 학습에 사용된 경주 수 |
| `weights` | JSON | 항목별 가중치 (`Record<string, number>`) |
| `correlations` | JSON | 항목별 Spearman ρ (`Record<string, number>`) |
| `applied_at` | string | 적용 시각 |

#### `combo_dividends` — 조합 확정배당 (migration 015, 2026-07-29)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `race_date` | number | 경주 날짜 (PK) |
| `meet` | number | 경마장 코드 (PK) |
| `rc_no` | number | 경주 번호 (PK) |
| `pool` | string | 조합 종류: `'복승식'\|'복연승식'\|'쌍승식'\|'삼복승식'\|'삼쌍승식'` (PK) |
| `leg1` | number | 첫째 말 출주번호 (PK) |
| `leg2` | number | 둘째 말 출주번호 (PK) |
| `leg3` | number | 셋째 말 출주번호 (3마리 조합 아니면 0) (PK) |
| `odds` | number | 확정배당 |
| `collected_at` | string | 수집 시각 |

> 결과 sync(dailySync)가 경주 결과 저장 직후 `API160_1/integratedInfo_1`에서 채워 넣는다(멱등 upsert, forward만). 단승/연승은 `race_entries`에 이미 존재하므로 여기 저장 안 함.

---

### 2.2 뷰 (Views)

#### `horse_sectional_ability` — 마별 통산 구간 능력치

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `hr_name` | string | 말 이름 |
| `races` | number | 집계 경주 수 |
| `avg_s1f` | number\|null | 평균 S1f 시간 |
| `best_s1f` | number\|null | 최단 S1f 시간 (출발 가속력) |
| `avg_last_600m` | number\|null | 평균 막판 600m |
| `best_last_600m` | number\|null | 최단 막판 600m (추격력) |
| `avg_last_200m` | number\|null | 평균 막판 200m |
| `best_last_200m` | number\|null | 최단 막판 200m |
| `avg_s1f_rank` | number\|null | 평균 S1f 순위 |
| `avg_g3f_rank` | number\|null | 평균 G3f 순위 |
| `avg_g1f_rank` | number\|null | 평균 G1f 순위 |
| `surge_score` | number\|null | 양수=추격형, 음수=선행형 |
| `avg_ord` | number\|null | 평균 착순 |
| `avg_position_ratio` | number\|null | 출전두수 정규화 출발 위치 (0=1등, 1=꼴등) |
| `stddev_position_ratio` | number\|null | 스타일 안정성 (≥0.35 → 자유마) |
| `front_run_success_rate` | number\|null | 출발 상위30% → 결승 상위30% 비율 |

#### `horse_running_style_by_distance` — 거리별 주행 성향

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `hr_name` | string | 말 이름 |
| `dist_category` | `'short'\|'middle'\|'long'` | 거리 카테고리 (<1400 / 1400-1800 / >1800m) |
| `races` | number | 집계 경주 수 (HAVING ≥ 2) |
| `avg_position_ratio` | number\|null | 평균 출발 위치 비율 |
| `stddev_position_ratio` | number\|null | 스타일 안정성 |
| `avg_finish_ratio` | number\|null | 평균 결승 위치 비율 |
| `avg_ord` | number\|null | 평균 착순 |

#### `race_sectional_stats` — 경주별 페이스 통계

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `race_date` | number | 경주 날짜 |
| `meet` | number | 경마장 코드 |
| `rc_no` | number | 경주 번호 |
| `rc_dist` | number\|null | 경주 거리 |
| `track_type` | string\|null | 주로 타입 |
| `horses` | number | 출전 두수 |
| `best_last_600m` | number\|null | 막판 600m 최단 기록 |
| `avg_last_600m` | number\|null | 막판 600m 평균 |
| `best_last_200m` | number\|null | 막판 200m 최단 기록 |
| `avg_last_200m` | number\|null | 막판 200m 평균 |
| `best_s1f` | number\|null | S1f 최단 기록 |
| `avg_s1f` | number\|null | S1f 평균 |

---

### 2.3 React Query 훅 목록 (프론트엔드)

파일: `client/src/lib/queries.ts`

#### 경주/예측

| 훅 | 파라미터 | 반환 | staleTime |
|----|---------|------|-----------|
| `useRacesByDate` | `rcDate: number` | `Race[]` | 5분 |
| `useHorsesByRace` | `rcDate, meet, rcNo` | `RaceEntry[]` | 5분 |
| `usePredictionsByRace` | `rcDate, meet, rcNo` | `Prediction[]` | 10분 |
| `usePredictionsByDate` | `rcDate` | `PredictionPreview[]` | 10분 |
| `useAvailableDates` | — | `number[]` | 1시간 |

#### 말 이력/분석

| 훅 | 파라미터 | 반환 | staleTime |
|----|---------|------|-----------|
| `useHorseHistory` | `hrName, beforeDate, limit?` | `RaceEntry[]` | 1시간 |
| `useHorseInfo` | `hrNo` | `Horse\|null` | 24시간 |
| `useHorseSectionalAbility` | `hrName` | `HorseSectionalAbility\|null` | 1시간 |
| `useHorseSectionalAbilityByNames` | `hrNames[]` | `HorseSectionalAbility[]` | 1시간 |
| `useHorseRunningStyleByDistance` | `hrName` | `HorseRunningStyleByDistance[]` | 1시간 |
| `useHorseGateStatsBatch` | `hrNames[]` | `Map<string, Map<pthr_no, stat>>` | 24시간 |
| `useHorseGradeDistStatsBatch` | `hrNames[], prizeCond, rcDist` | `Map<hrName, GradeDistStat>` | 24시간 |

#### 기수/조교사

| 훅 | 파라미터 | 반환 | staleTime |
|----|---------|------|-----------|
| `useJockeyStats` | `jckyNo, meet?` | `JockeyStat[]` | 24시간 |
| `useJockeyStatsBatch` | `jckyNos[], meet` | `Map<jckyNo, JockeyStat>` | 24시간 |
| `useJockeyRecentForm` | `jckyNo, meet, daysBack=90` | `{total,wins,places,shows}\|null` | 24시간 |
| `useJockeyHorseComboBatch` | `{hrName,jckyNm}[]` | `Map<"hrName:jckyNm", stat>` | 24시간 |
| `useTrainerStats` | `trainerName` | `{total,wins,places,shows}\|null` | 24시간 |
| `useTrainerStatsBatch` | `trainerNames[]` | `Map<trainerName, stat>` | 24시간 |

#### 훈련

| 훅 | 파라미터 | 반환 | staleTime |
|----|---------|------|-----------|
| `useHorseTraining` | `hrNo, daysBack=30` | `TrainingLog[]` | 30분 |
| `useTrainingBatchByNames` | `hrNames[], meet, daysBack=30` | `Map<hrName, TrainingLog[]>` | 30분 |

#### 통계/분석

| 훅 | 파라미터 | 반환 | staleTime |
|----|---------|------|-----------|
| `useMonthlyHitRate` | `monthsBack=12` | `MonthlyHitRate[]` | 10분 |
| `useLatestWeights` | — | `weight_history row\|null` | 1시간 |
| `useWeightHistory` | `limit=5` | `WeightHistoryRow[]` | 30분 |
| `useLatestCorrelations` | — | `Record<string,number>\|null` | 30분 |
| `useRecentArchives` | `limit=30` | `ArchiveRow[]` | 10분 |
| `useEarningsHitRate` | — | `EarningsBucket[]` | 30분 |
| `useGradeWinnerStats` | `prizeCond, rcDist` | `{avg,best,count,avgBurdWgt}\|null` | 24시간 |
| `useRaceSectionalStats` | `rcDate, meet, rcNo` | `RaceSectionalStats\|null` | 10분 |
| `useRaceCardsCoverage` | — | `{totalRows,injuredRows,...}` | 30분 |
| `useHistoryRacesPrizeCond` | `{race_date,meet,rc_no}[]` | `Map<key, prize_cond>` | 24시간 |

#### 사용자 설정

| 훅 | 파라미터 | 반환 | staleTime |
|----|---------|------|-----------|
| `useUserSettings` | — | `user_settings row` | 10분 |

---

## 3. Anthropic Claude API

| 항목 | 값 |
|------|---|
| SDK | `@anthropic-ai/sdk` v0.30.0 |
| API 키 | `ANTHROPIC_API_KEY` (`sk-ant-...`) |
| 월별 한도 | `ANTHROPIC_MONTHLY_LIMIT` (기본 5 USD) |
| 일별 한도 | `ANTHROPIC_DAILY_LIMIT` (기본 0.20 USD) |
| 상태 | ⏳ **미구현** — 환경변수·한도 설정만 존재 |

### 향후 계획

- 경주별 AI 코멘트 자동 생성
- PDF 보고서 생성
- 유튜브 대본 자동 생성

구현 위치 예정: `src/ai/` (현재 비어 있음)

---

## 4. 공통 사항

### 날짜 형식

모든 날짜는 `YYYYMMDD` 정수형 (예: `20260531`).

### 페이지네이션

KRA API 전체 수집 시 `getAllXxx()` 메서드를 사용 (`pageNo` 자동 증가, 안전 상한 20~50).  
Supabase 1000행 제한 우회 시 `.range(offset, offset+999)` 반복.

### 에러 처리

```
KRA API: resultCode !== "00" → Error 발생
Supabase: { data, error } 구조 분해 → error 있으면 throw
```

### 환경 변수

| 변수 | 사용처 |
|------|--------|
| `KRA_API_KEY` | 백엔드 `src/kra/client.ts` |
| `SUPABASE_URL` | 백엔드 `src/db/supabase.ts` |
| `SUPABASE_ANON_KEY` | — (백엔드 미사용) |
| `SUPABASE_SERVICE_ROLE_KEY` | 백엔드 `src/db/supabase.ts` (RLS 우회) |
| `VITE_SUPABASE_URL` | 프론트 `client/src/lib/supabase.ts` |
| `VITE_SUPABASE_ANON_KEY` | 프론트 `client/src/lib/supabase.ts` |
| `ANTHROPIC_API_KEY` | 백엔드 `src/utils/env.ts` (미구현) |

### 관련 문서

- [docs/kra_api_quirks.md](kra_api_quirks.md) — KRA API 컬럼명 함정 상세
- [docs/architecture.md](architecture.md) — 시스템 전체 그림
- [docs/data_flow.md](data_flow.md) — KRA API → DB → ScoreEngine → UI 흐름
