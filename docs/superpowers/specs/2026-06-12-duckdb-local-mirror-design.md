# DuckDB 로컬 읽기 미러 — 설계 스펙

> 작성: 2026-06-12 · 상태: 설계 승인됨, 구현 대기
> 목적: Supabase egress 한도에서 분석·백테스트를 영구 분리한다.

---

## 0. 문제와 목표

### 문제
- Supabase 무료 플랜 **egress(읽기 전송) 5GB/월**이 소진되어 프로젝트가 **Restricted(402)** 상태. 읽기·쓰기 전부 차단.
- egress를 태우는 범인은 **분석·백테스트 스크립트가 원시 테이블(`race_entries` 등)을 반복 풀스캔**하는 것. 데이터 자체는 작음(전체 수십 MB) — 용량 문제가 아니라 **반복 읽기 전송량** 문제.

### 목표
- 분석·백테스트의 **읽기를 로컬 DuckDB 파일로** 옮겨 egress 0으로 만든다.
- **쓰기(sync)·라이브 예측·웹앱은 Supabase 그대로 둔다** (웹앱이 Supabase를 읽으므로).
- 스크립트 변경 최소화: 클라이언트 주입만 교체.
- 라이브 예측 경로(`gatherRaceInputs` 등 공유 코드)는 **분기 없이 한 벌 유지**.

### 비목표 (YAGNI)
- 분석을 KRA API로 직접 쌓는 "Supabase 완전 독립" 영구 구조 → **별도 후속 프로젝트**. 본 스펙은 Supabase를 원본으로 두는 읽기 미러까지만.
- DuckDB 쓰기(insert/upsert) 어댑터 → 본 스펙 범위 밖(읽기 전용).
- 증분 동기화 최적화 → 전체 새로고침으로 충분(데이터 작음).

---

## 1. 큰 그림

```
[Supabase] ──(db:pull, 가끔 1회)──▶ [data/local.duckdb] ◀──(읽기)── 분석·백테스트
   ▲  (원본 = SSOT)                    (읽기 사본)              getReadClient()
   │
   └── 쓰기(sync)·라이브 예측·웹앱은 그대로 Supabase
```

세 조각:
1. **`src/db/localDb.ts`** — DuckDB를 supabase-js처럼 보이게 감싸는 **읽기 어댑터**
2. **`scripts/sync_local_db.ts`** (`npm run db:pull`) — Supabase → DuckDB **덤프**
3. **`getReadClient()`** — 분석 스크립트가 호출. 기본 DuckDB, `DB_SOURCE=supabase`면 진짜 Supabase로 폴백.

---

## 2. 어댑터 (`src/db/localDb.ts`)

### 흉내 낼 표면적 (실측 — 조인·`.or()` 없음, 전부 평면)
체인 메서드:
`.from(table)` → `.select(cols)` → 필터 `.eq .neq .gt .gte .lt .lte .in .is .not` → `.order(col, {ascending})` → `.range(from,to)` → `.limit(n)` → 종결 `.single() / .maybeSingle()` 또는 그냥 `await`(배열 반환).

반환: `{ data, error }` (supabase-js와 동일 형태). 쿼리 빌더는 **thenable** — 종결 메서드 없이 `await query`만 해도 실행되어 `{data,error}` 해석.

### 동작
체인에 쌓인 필터를 **파라미터화된 SQL**로 번역해 DuckDB에서 실행.

| supabase-js | SQL |
|---|---|
| `.eq('c', v)` | `c = ?` |
| `.neq('c', v)` | `c <> ?` |
| `.gt/gte/lt/lte` | `c > ? / >= / < / <=` |
| `.in('c', arr)` | `c IN (?, ?, …)` |
| `.is('c', null)` | `c IS NULL` |
| `.not('c', 'is', null)` | `c IS NOT NULL` |
| `.order('c', {ascending:false})` | `ORDER BY c DESC` (다중 `.order` = 누적) |
| `.range(a, b)` | `LIMIT (b-a+1) OFFSET a` |
| `.limit(n)` | `LIMIT n` |
| `.select('a, b')` | `SELECT a, b` (기본 `*`) |

- `.single()` = 정확히 1행 아니면 error / `.maybeSingle()` = 0~1행, 0이면 `data:null`.
- 컬럼·테이블명은 화이트리스트(미러된 테이블·실제 컬럼)만 허용 → SQL 인젝션·오타 방어.
- 미러 파일/테이블 없음 → 명확한 에러: `"data/local.duckdb 없음 — npm run db:pull 먼저 실행"`.

### 라이브러리
- **`@duckdb/node-api`** (공식 Neo 클라이언트, Windows prebuild 제공).
- ⚠️ **열린 리스크**: 구현 0번째 단계에서 Windows(win32, Node)에 설치·기본 쿼리가 붙는지 **먼저 검증**. 안 붙으면 대안 `duckdb`(레거시) 또는 `duckdb-async` 평가.

### 주입 헬퍼 (`src/db/readClient.ts` 또는 localDb.ts 내)
```
getReadClient(): DB_SOURCE !== 'supabase' 이면 getLocalDb(), 아니면 getSupabaseAdmin()
```
- 분석 스크립트: `getSupabaseAdmin()` → **`getReadClient()`** 한 줄 교체.
- `gatherRaceInputs(sb, …)`는 이미 클라이언트를 인자로 받음 → extract는 `getReadClient()` 주입, 라이브는 진짜 Supabase. **코드 한 벌.**
- 덤프 스크립트·sync·라이브 쓰기는 `getSupabaseAdmin()` 직접 사용(폴백 아님).

---

## 3. 덤프 스크립트 (`npm run db:pull`)

Supabase 원본 테이블/뷰를 페이지네이션(1000행)으로 통째 읽어 DuckDB에 적재.

- 기본: **전체 새로고침** (대상 테이블 DROP+CREATE+INSERT). 데이터 작아 충분.
- `--table race_entries` : 한 테이블만 갱신(백필 후 그 테이블만 반영용).
- 스키마: Supabase 컬럼명·타입을 그대로 DuckDB 테이블로. 타입은 첫 행 추론 + 명시 매핑(숫자/문자/불리언/타임스탬프).

### 대상 (분석이 읽는 것 — 실측 `.from()` 기준)
`race_entries · races · predictions · horses · horse_results · model_versions · weight_history · race_cards · jockey_stats · training_logs · race_sectional_stats · race_par_times`
\+ 뷰 2개: `horse_sectional_ability · horse_running_style_by_distance` (뷰의 **결과 행을 테이블로 굳혀** 적재).

> 목록은 `grep "\.from('...')"` 실측에서 도출. 누락 발견 시 대상 배열에 추가.

egress: 이 덤프 1회 = 수십 MB(5GB 한도 대비 무시 가능). 이후 분석 읽기는 egress 0.

---

## 4. 새 데이터 추가 워크플로우

대원칙: **Supabase = 원본(진실), DuckDB = 읽기 사본.** DuckDB에 직접 쓰지 않는다.

### 정식 데이터(웹앱·라이브가 봄 — 백필류, 복승 배당 포함)
사용자 결정: **복승 배당도 웹앱에 노출** → Supabase 정식 테이블로 간다.
```
1. (선택) db:pull            # 미러 최신화
2. 백필/수집 실행
   - 읽기(대량 계산) → getReadClient()   = DuckDB (egress 0)
   - 쓰기(결과 저장) → getSupabaseAdmin() = Supabase (ingress, 거의 무료)
3. db:pull --table <그 테이블>  # 미러 갱신
```
백필 스크립트는 읽기·쓰기 클라이언트 **둘 다** 사용.

### 분석 전용 임시 데이터
KRA API → 로컬 jsonl(현행). DuckDB는 jsonl을 직접 읽음(`SELECT * FROM 'data/x.jsonl'`). 필요 시 분석 세션에서 DuckDB 임시 테이블로 얹음. **Supabase 미경유.**

---

## 5. 검증 전략

### 핵심 안전장치 — byte-identical 재현
어댑터가 Supabase와 동일하게 동작함을 증명: **`extract:matrix`를 `getReadClient()`(DuckDB)로 다시 돌려 기존 `data/training_matrix.jsonl`과 1바이트도 안 틀리게 일치**시킨다. 일치 = 어댑터의 필터·정렬·페이지네이션이 정확.
- 단, 이 검증은 DuckDB에 데이터가 있어야 함 → **6/23 리셋 후 db:pull 완료 시점에 수행**.
- 그 전까지는 어댑터 단위 테스트로 정확성 담보.

### 어댑터 단위 테스트 (TDD, Supabase 불필요)
작은 시드 DuckDB(in-memory 또는 임시 파일)에 알려진 행을 넣고, 각 필터 메서드 → 기대 행 매핑 검증:
- 단일/복합 필터(`eq`+`gte`+`in`), `is null`/`not is null`
- 다중 `order` + `ascending`
- `range`/`limit` 경계
- `single`/`maybeSingle` (0행·1행·다행)
- 미러 부재 시 명확한 에러
- 컬럼 화이트리스트 위반 거부

---

## 6. 단계 (Phasing)

### Phase 1 — 인프라 (지금, Supabase 불필요)
1. `@duckdb/node-api` Windows 설치·기본 쿼리 검증 (열린 리스크 먼저 해소)
2. 어댑터 `src/db/localDb.ts` + `getReadClient()` — **TDD**
3. 덤프 스크립트 `scripts/sync_local_db.ts` + `db:pull` (Supabase 미접속 상태라 코드만 완성, 실행은 Phase 3)
4. `extract:matrix`를 `getReadClient()` 사용하도록 배선 (gatherRaceInputs 주입)

기존 `training_matrix.jsonl`로 분석은 그동안 계속 가능.

### Phase 2 — 새 데이터 필요 시에만 (11일 내 발생하면)
- 특정 조각만 KRA API로 로컬 파일에 타겟 수집(전체 재수집 아님). 발생 안 하면 생략.

### Phase 3 — 6/23 egress 리셋 후
1. `db:pull` 1회 → DuckDB 미러 완성, **영구 탈출**
2. byte-identical 검증(§5) 통과 확인
3. 나머지 분석 스크립트(`backtest:box`·`backtest:box:quarters`·`probe:corr`·gate·probe류)에 `getReadClient()` 전파
4. 복승 배당 Supabase 정식 테이블화 + 웹앱 노출 (별도 작업)

### (후속·선택) 분석 KRA-직결 영구구조
분석을 Supabase에서 완전 독립시키는 구조. 본 스펙 범위 밖, 별도 스펙.

---

## 7. 정상 상태 (왜 다시 안 막히나)

| 작업 | 대상 | egress |
|---|---|---|
| 분석·백테스트 읽기 | DuckDB | **0** |
| sync·백필·복승 쓰기 | Supabase | ingress(거의 무료) |
| 웹앱 읽기 | Supabase | 저트래픽이라 적음 |
| 가끔 db:pull | Supabase | 수십 MB |

읽기 egress(범인) 제거 → 총 egress 5GB 한참 아래 → 재발 방지.

---

## 8. 리스크·완화

| 리스크 | 완화 |
|---|---|
| `@duckdb/node-api` Windows 미설치 | Phase 1-0에서 **최우선 검증**, 안 되면 `duckdb`/`duckdb-async` 대안 |
| 어댑터가 supabase-js 동작과 미묘하게 다름 | byte-identical 재현(§5) + 단위 테스트 |
| 라이브 예측 경로 오염 | `gatherRaceInputs`는 클라이언트 주입만 교체, 코드 분기 없음. 라이브는 `getSupabaseAdmin()` 고정 |
| 미러 staleness(오래된 사본) | 백필/수집 후 `db:pull --table` 규칙. 분석은 스냅샷 기준임을 인지 |
| 뷰를 테이블로 굳히면 원본 갱신 안 따라옴 | `db:pull` 재실행 시 뷰 결과 재적재 |

---

## 9. 산출물 요약

| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/db/localDb.ts` | DuckDB 읽기 어댑터 (supabase-js 흉내) | 신규 |
| `src/db/readClient.ts` | `getReadClient()` 주입 헬퍼 | 신규(또는 localDb.ts 내) |
| `scripts/sync_local_db.ts` | `db:pull` 덤프 | 신규 |
| `src/db/localDb.test.ts` | 어댑터 단위 테스트 | 신규 |
| `package.json` | `db:pull` 스크립트, `@duckdb/node-api` 의존성 | 수정 |
| `scripts/extract_training_matrix.ts` | `getReadClient()` 배선 | 수정 |
| `src/utils/env.ts` | `DB_SOURCE` 환경변수(optional, 기본 local) | 수정 |
| `.gitignore` | `data/local.duckdb` 제외 | 수정 |
| 나머지 분석 스크립트 | `getReadClient()` 전파 (Phase 3) | 수정 |
