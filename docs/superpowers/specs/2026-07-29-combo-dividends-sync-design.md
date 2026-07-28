# 조합 확정배당 수집 (결과 sync 통합) — 설계

> 작성: 2026-07-29 · 상태: 승인 대기(사용자 리뷰) → writing-plans
> 관련: [[project_launch_gating_ops]], [[reference_kra_dividend_api]], docs/status/05-data-infra.md

## 1. 목표 / 범위

자동 결과 sync(`src/sync/dailySync.ts`)가 한 경주의 결과를 받을 때, 그 경주의 **조합
확정배당**을 `API160_1/integratedInfo_1`에서 함께 받아 새 DB 테이블 `combo_dividends`에
저장한다.

- **대상 조합식(pool):** 복승식·복연승식·쌍승식·삼복승식·삼쌍승식.
- **범위:** 앞으로(결과 sync 실행분)만. **과거 백필은 별도 작업으로 미룸.**
- **단승/연승 배당은 대상 아님** — 이미 `race_entries.win_odds`/`plc_odds`에 저장됨(중복 방지).

### 현재 상태(배경)
- 결과 sync는 말별 단승(`win_odds`)·연승(`plc_odds`)만 `race_entries`에 기록.
- 조합 배당 수집 코드는 `scripts/collect_combo_dividends.ts`에 이미 있으나 **오프라인 백필
  + 로컬 JSONL 파일** 성격(DB 미저장, 2마리 조합만). 이 설계는 그 로직을 클라이언트로
  흡수하고 **자동 sync + DB 저장 + 3마리 조합**으로 확장한다.

## 2. 데이터 모델 — `combo_dividends` (migration 015)

```sql
CREATE TABLE IF NOT EXISTS combo_dividends (
  race_date    INT         NOT NULL,
  meet         INT         NOT NULL,          -- 1=서울, 3=부산경남
  rc_no        INT         NOT NULL,
  pool         VARCHAR(20) NOT NULL,          -- '복승식'|'복연승식'|'쌍승식'|'삼복승식'|'삼쌍승식'
  leg1         INT         NOT NULL,          -- 첫째 말 출주번호(chulNo)
  leg2         INT         NOT NULL,          -- 둘째 말
  leg3         INT         NOT NULL DEFAULT 0, -- 셋째 말(3마리 조합만, 없으면 0)
  odds         NUMERIC     NOT NULL,          -- 확정배당
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (race_date, meet, rc_no, pool, leg1, leg2, leg3)
);
```

### 핵심 결정
- **API가 준 순서 그대로 저장(정렬 안 함).** 쌍승·삼쌍승은 leg 순서가 착순 순서라 의미가
  있으므로 정규화하지 않는다. 복승·복연승·삼복승은 순서無지만 저장은 raw, **정규화는
  분석(read) 시점**에.
- **leg3는 NULL이 아니라 0.** Postgres는 UNIQUE/PK에서 NULL을 서로 다르게 취급해 2마리
  조합 upsert가 매번 중복 삽입된다. 0(유효하지 않은 게이트번호)을 "셋째 말 없음" 센티넬로
  써서 PK/upsert 멱등을 보장.
- **멱등:** PK onConflict upsert → 재실행(같은 날 목·금·재수동 등) 안전.

## 3. 컴포넌트

### 3.1 `KRAClient.getComboDividends(params)` — `src/kra/client.ts`
```
getComboDividends(params: { meet: MeetCode; rcDate: number; rcNo: number })
  : Promise<KRAComboDividend[]>
```
- 엔드포인트 `/API160_1/integratedInfo_1`, 파라미터 `serviceKey, meet, rc_date, rc_no,
  pageNo, numOfRows=1000, _type=json`.
- **재시도는 기존 `getWithRetry` 경유** — `collect_combo_dividends.ts`의 손수 fetch+backoff를
  대체해 재시도 로직 일원화(타임아웃/네트워크/5xx 재시도).
- 페이지네이션: `totalCount` 기반 ≤5페이지.
- 응답 아이템 타입 `KRAComboDividend { pool: string; chulNo: number; chulNo2: number;
  chulNo3: number; odds: number; rcNo: number }`.
- **pool 필터는 호출부에서** (API가 pool 입력필터를 무시 → 전체 반환). 대상 pool 집합은
  상수 `COMBO_POOLS`(한 곳 정의, client 또는 transformer)로.

### 3.2 `dailySync` 통합 — `src/sync/syncMeet` 경주 루프
- **결과(race_entries) UPDATE/INSERT 직후**, 결과 도착 경주에 한해:
  1. `getComboDividends({ meet, rcDate, rcNo })` 호출.
  2. 대상 pool(`COMBO_POOLS`)만 필터.
  3. 각 아이템 → `{ race_date, meet, rc_no, pool, leg1: chulNo, leg2: chulNo2,
     leg3: chulNo3 || 0, odds }` upsert(onConflict PK).
- **실행 조건:** `skipPredictions === false`일 때만. 대량 백필 경로
  (`scripts/backfill_results.ts`, `skipPredictions=true`)에서는 자동 skip → 백필이 조합
  API로 폭주하지 않음("앞으로만" 범위와 일치).
- 변환 로직(아이템→row)은 `src/sync/transformer.ts`에 순수 함수로 두어 단위 테스트.

## 4. 데이터 플로우

```
KRA 결과 API(214_1) → race_entries 결과 UPDATE (기존)
                     → KRA API160_1(integratedInfo) → pool 필터 → combo_dividends upsert (신규)
                     → 다음 경주
```

## 5. 에러 처리

- **조합 수집 실패는 경주 결과 저장을 되돌리지 않는다.** try/catch로 감싸 경고 로그
  (`⚠️ [meet, rcNo] 조합배당 수집 실패(계속): …`) 후 다음 단계로. 기존 "예측 보충 실패
  (계속)" 패턴과 동일 — 결과 sync 본류가 조합 때문에 죽지 않게.
- `getWithRetry`가 일시적 네트워크/타임아웃/5xx는 이미 흡수.

## 6. 테스트

- **`getComboDividends`** (client.test.ts 추가): mock axios로 페이지네이션·파싱·재시도.
- **변환 순수함수** (transformer 테스트): 아이템→row 매핑, leg3=0 처리, pool 필터.
- **통합** (dailySync.test.ts): 페이크 Supabase에 `combo_dividends` 테이블 추가 →
  결과 sync 시 대상 pool upsert 확인 + `skipPredictions=true`면 조합 수집이 안 도는지.

## 7. 범위 컷 (YAGNI)

- pool별 정규화(복승 정렬)·UI 표시·특정 계산(백테스트/ROI) 연결 — **안 함**. 저장까지만.
- DuckDB 미러 반영(`db:pull` 대상 추가) — 분석 필요 시점에. 지금은 Supabase 쓰기만.
- 과거 백필 — 별도 작업(추후). 기존 `collect_combo_dividends.ts`를 DB upsert로 개조하는
  방향 유력하나 이 설계 밖.
- 삼복승/삼쌍승 위 조합(4마리+)은 KRA에 없음 → leg3까지로 충분.

## 8. 열린 질문 / 확인 필요(구현 중)

- `API160_1` 응답의 실제 pool 명칭 정확 표기('복승식' 등 접미사) — 기존 스크립트가
  `'복연승식'`/`'복승식'`으로 필터하므로 접미사 '식' 포함. 삼복승/삼쌍승/쌍승의 정확한
  pool 문자열은 구현 시 실응답으로 확정(probe 1회 또는 기존 수집 데이터로 확인).
- `odds` 단위(배율 vs 원) — 기존 스크립트가 `it.odds` 그대로 저장하므로 동일하게 raw 저장.
