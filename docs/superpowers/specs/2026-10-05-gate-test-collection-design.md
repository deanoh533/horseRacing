# 주행심사 기록 수집 파이프라인 — 설계 (하위 과제 ①)

> 작성: 2026-10-05 · 상태: 설계 승인 대기 · 브랜치 `feat/gate-test-collection`
> 상위 과제: 주행심사 기록 정식화 = ① 수집(이 문서) → ② 데뷔·휴양복귀 피처 + 사전등록 통제 A/B → ③ 출마정보 화면 표시
> 근거: TODO W-008 · 메모리 project-gate-test-debut · 스파이크(2026-10-05, 임시 수집 7,536행)

## 1. 목적과 성공 기준

**목적.** 마사회 홈페이지에만 공개되는 주행심사 결과를 Supabase에 안정적으로 쌓는다. ②피처와 ③화면이 이 테이블만 읽는다.

**왜.** 모델은 데뷔전에서 무작위 수준(전원 데뷔 경주 연승 35.5% vs 인기1위 80.6%). 스파이크에서 주행심사 회차 내 상대기록이 다음 경주를 강하게 설명했다(신마 빠름 1/3 연승 36.7% vs 느림 11.8%). 시장이 대부분 반영하므로 **시장 격파가 아니라 모델의 데뷔·휴양복귀 구멍 메우기**가 목적이다.

**성공 기준.**
1. 2022-01-01 이후 심사가 있던 모든 날짜·회차의 행이 저장된다(누락 검증 §6).
2. 매주 목·금·토 심사분이 다음 날 아침 캐치업에서 반영된다 → 수요일 오후 출마표 발표 전에 그 주 심사가 이미 들어와 있다.
3. 수집 실패가 결과 캐치업 잡을 실패시키지 않고, 다음 날 자동으로 메워진다.

## 2. 출처 (실측 2026-10-04~05)

- 목록: `GET https://race.kra.co.kr/referee/RacingTrainCheckList.do?Act=07&Sub=8&meet={1|3}` — 최근 약 6개월, 10회차/페이지(`pageIndex` POST). 행마다 심사일·회차·편성두수·합격두수·합격률. 회차 상세 링크 = `goPage1("회차","YYYYMMDD")`.
- 상세: `POST https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do` body `trno, date, meet, Act=07, Sub=8`. **날짜를 직접 지정하면 목록에 없는 과거(2022-01 확인)도 열린다.**
- 응답 EUC-KR. 표 caption `주행심사결과를 순위, 마번, ...`의 tbody, 행당 16칸: 순위·마번(게이트)·마명(링크 `goPage1('hr_no', ...)`)·심사사유·산지·성별·연령·부담중량·기수·조교사·마주·마체중·기록(`1:03.4`)·도착차·판정·사유. 상단 경주정보에 `주로상태 : 건조 ( 3％ )`.
- 심사가 없는 날짜·회차 = 빈 표(응답 ~31KB, tbody 행 0).
- **심사 요일이 고정이 아니다**: 서울 2022~2023 금요일 → 2024~ 목요일, 부경 2022~2024 토요일 → 이후 목·금. 공휴일 이동도 있다.
- robots.txt: `/referee` 허용(`Disallow`는 `/license`, `/search`만). 공공 API 아님 — 공식 이용약관은 미확인.
- 심사사유 값 예: `주행미합(신)`(신마), `장기휴양(재)`, `장기휴양도래(재)`, `주행지정(재)`, `주행불량(연속)(0/1)`, `연습주행`. 판정 값: `합격`·`불합격`·`출전제외`·`출전취소`·`연습주행`·`연습취소`.

## 3. 데이터 — `gate_tests` (migration 019)

```sql
CREATE TABLE IF NOT EXISTS gate_tests (
  test_date      INT          NOT NULL,   -- 심사일 YYYYMMDD
  meet           INT          NOT NULL,   -- 1=서울, 3=부산경남 (주행심사 페이지 기준 개최지)
  trno           INT          NOT NULL,   -- 그날 회차(경주) 번호
  hr_no          VARCHAR(10)  NOT NULL,   -- 마번 (race_entries.hr_no와 같은 형식 '0052911')
  hr_name        VARCHAR(50)  NOT NULL,
  rank           INT,                     -- 순위 (기록 없으면 NULL)
  gate_no        INT,                     -- 게이트(마번 칸)
  reason         VARCHAR(40),             -- 심사사유
  origin         VARCHAR(20),             -- 산지
  sex            VARCHAR(4),
  age            INT,
  burden         VARCHAR(20),             -- 부담중량 원문 ('53+ 1.0')
  jockey         VARCHAR(30),
  trainer        VARCHAR(30),
  owner          VARCHAR(50),
  body_weight    INT,                     -- 마체중
  time_sec       NUMERIC,                 -- 기록(초). '1:03.4' → 63.4, 없으면 NULL
  margin         VARCHAR(20),             -- 도착차 원문
  verdict        VARCHAR(20) NOT NULL,    -- 판정
  verdict_reason VARCHAR(100),
  track_cond     VARCHAR(30),             -- 주로상태 원문
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (test_date, meet, trno, hr_no)
);
-- RLS: 015_combo_dividends 관례 — anon 읽기, 쓰기는 service_role만.
```

- PK 첫 칸이 날짜 → 미러 증분 규칙 충족(`tableSpecs.ts`: `{ mode: 'incremental', dateCol: 'test_date', orderCols: ['meet','trno','hr_no'] }`).
- 값은 원문 보존 위주(부담중량·도착차·주로상태). 해석(상대기록 등)은 ②에서 한다 — 원천은 raw.
- 쓰기는 `(test_date, meet, trno, hr_no)` 기준 멱등 upsert.

## 4. 구성 요소

| 파일 | 책임 |
|---|---|
| `supabase/migrations/019_gate_tests.sql` | 테이블 + RLS |
| `src/kra/gateTest.ts` | **순수**: `parseGateTestHtml(html, meet, date, trno) → GateTestRow[]`, `parseGateTestList(html) → {date, trno}[]`, `toSeconds('1:03.4')`. **I/O**: `fetchGateRound(meet, date, trno)`, `fetchGateList(meet, pageIndex)` — EUC-KR 해독, 30초 시간제한, 3회 재시도(5초 간격), 호출 사이 2초 |
| `src/sync/gateTestSync.ts` | 두 모드. `backfill(from, to)`: 날짜를 하루씩 훑어 회차 1부터 빈 표가 나올 때까지 받기, 이미 DB에 있는 (날짜·경마장)은 건너뜀(재개 가능). `recent()`: 서울·부경 목록 1페이지 → DB에 없는 (날짜·회차)만 받기 |
| `scripts/gateTestSync.ts` 진입점 + `package.json` | `npm run sync:gate -- --from YYYYMMDD --to YYYYMMDD` (백필) / `npm run sync:gate` (최근분) |
| `.github/workflows/sync.yml` | 결과 캐치업 잡에 `sync:gate` 단계 추가, **`continue-on-error: true`** — 실패해도 잡은 성공, 로그에 경고 |
| `src/db/mirror/tableSpecs.ts` | `gate_tests` 증분 대상 추가 |
| `tests/kra/gateTest.test.ts` + `tests/kra/fixtures/gate_*.html` | 실제 응답 HTML 3종(정상 회차·빈 표·목록)으로 파서 테스트 |
| `docs/api_spec.md` | 출처·필드·quirk 섹션 추가(API 변경 시 동반 갱신 관례) |

**하지 않는 것(YAGNI).** 목록의 합격률 저장, 말 상세(`goPage1` 말 페이지) 수집, 기수·조교사 번호 정규화, 제주(meet 2)·영천(meet 4). 영천 목록(`meet=4`)은 심사 기록이 비어 있음(2026-10-05 확인) — 영천 출주마는 부경 상주마라 부경에서 심사받는다.

## 5. 실행 방식

- **백필(1회).** 2022-01-01 ~ 오늘−1, 경마장 2곳 × 약 1,740일. 심사 없는 날 1요청, 심사 있는 날 회차+1요청 → 약 6,000요청 × 2초 ≈ 3~4시간. 로컬에서 사용자가 실행(장시간·외부 사이트). 끊겨도 다시 실행하면 이어진다.
- **매일.** 결과 캐치업 잡(매일 07:00 KST) 마지막 단계. 목록 1페이지 2곳 + 새 회차 수만큼 → 평상시 2~12요청. GitHub 러너의 KRA 접속 실패(실측 17~29%)는 다음 날 재시도로 흡수 — 목록이 6개월치를 보여주므로 며칠 연속 실패해도 메워진다.
- **예의.** 요청 간 2초, User-Agent 고정, 동시 요청 없음.

## 6. 오류 처리와 검증

- 네트워크 실패: 3회 재시도 후 그 (날짜·회차)만 실패로 기록하고 계속. 실행 끝에 실패 목록 출력, 실패가 있으면 종료코드 1(Actions에서는 continue-on-error로 경고만).
- 파서 이상: 표는 있는데 행이 16칸 미만이면 그 행은 건너뛰고 경고 카운트. hr_no를 못 읽으면 행 건너뜀(PK 필수).
- **누락 검증**(`recent()` 끝에서): 목록의 각 회차 `편성두수` vs DB 행 수 비교, 다르면 경고(재수집 대상).
- 백필 완료 후 확인: 연도·경마장별 심사일 수(스파이크 2024~2025: 각 98일)와 회차 수 표.

## 7. 테스트

- 파서: 정상 회차 fixture → 행 수·첫 행 전 필드(hr_no `0056500`, time 63.4, verdict `합격`, track_cond), 빈 표 → `[]`, 목록 fixture → (날짜·회차) 목록, `toSeconds` 경계(`'1:03.4'`, `''`, `'-'`).
- 동기화 로직: DB 조회·HTTP를 주입식으로 받아 "이미 있는 회차 건너뜀"·"빈 표에서 회차 루프 종료"·"실패 격리" 단위 테스트(기존 `catchupLogic` 패턴).

## 8. 열린 질문 (②에서 결정)

- 피처 정의(회차 내 상대기록·순위 백분위·합격 여부·심사→경주 간격·재심사 횟수), 휴양복귀 포함 여부, 사전등록 합격선.
- 스파이크 결과: 시장이 대부분 반영 → 기대 효과는 데뷔 포함 경주의 모델 적중 회복, 전체 연승 기여는 작을 수 있음.
