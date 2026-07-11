# 런치 게이팅 운영 기반 (L-002~005) — 설계 스펙

> 2026-07-11 · 상태: 사용자 승인
> 배경: v7 라이브 적중률 추적 시작(L-001 완료) 직후, 추적 데이터가 조용히 새는 것을 막는 운영 기반 구축. TODO.md "운영 직전 필수" 섹션의 나머지 4항목.

## 0. 사용자 결정 사항 (2026-07-11 버튼 확정)

| 항목 | 결정 |
|---|---|
| L-002 실행 환경 | **GitHub Actions cron** (PC 무관, 실패 이메일 무료) |
| L-003 재학습 주기 | **v7 판정까지 동결 → 분기 1회**, 실행은 전 과정 수동 유지 |
| L-004 알림 채널 | **GitHub 기본 이메일** (워크플로우 실패 시 자동) |
| L-005 백업 범위 | **스냅샷 스크립트 + db:pull 미러 공식화** (주간 pg_dump는 범위 밖) |

## 1. L-002 sync 자동화

### 1.1 워크플로우

`.github/workflows/sync.yml` 신설 — 잡 2개, 스케줄 2개 (cron은 UTC로 기재):

| 잡 | 실행 시각 (KST) | cron (UTC) | 명령 | 대상 |
|---|---|---|---|---|
| `racecard` | 수·목·금 15:00 | `0 6 * * 3,4,5` | `npm run sync:cards` | 이틀 뒤 경주 (수→금경, 목→토경, 금→일경) |
| `results` | 토·일·월 01:00 | `0 16 * * 5,6,0` | `npm run sync` | 어제 경주 (dailySync 기존 기본값) |

- 워크플로우 전역 `env: TZ: Asia/Seoul` — 러너는 UTC이므로 Node의 "오늘/어제" 계산을 한국 기준으로 고정. **이 설정이 없으면 results 잡의 "어제"가 하루 어긋남.**
- 워크플로우 전역 `env: DB_SOURCE: supabase` — 예측 생성의 읽기 경로(`getReadClient`, src/db/localDb.ts)가 기본값 `local`이면 DuckDB 미러 파일을 찾는데 **러너엔 미러가 없음**. Supabase 직접 읽기로 전환 (경마일당 읽기량은 소규모라 egress 부담 미미).
- `workflow_dispatch` 트리거 추가 — 실패 시 GitHub 웹에서 수동 재실행. 날짜 입력(optional input)으로 특정일 재처리도 지원.
- Actions cron은 수 분~수십 분 지연될 수 있음 — 출마표는 발표(14:30) 30분 뒤로 잡아 흡수, 결과는 새벽이라 무관.
- L-001 보호 로직(사전 예측 보존, `actual_ord`만 UPDATE, raceCardSync 결과도착 가드)은 같은 명령 경로라 추가 작업 없음.

### 1.2 코드 수정: raceCardSync 날짜 기본값

현재 `raceCardSync`는 `--date` 필수(없으면 usage 출력 후 exit 1). **인자 생략 시 "오늘(KST)+2일"을 기본값**으로 추가:

- 근거: 출마표 발표일→경주일이 항상 +2일 (수 발표=금경, 목=토경, 금=일경 — docs/data_lifecycle.md).
- 기존 `--date YYYYMMDD` 명시 동작은 불변. `--meet` 등 다른 인자도 불변.
- 날짜 계산은 시스템 TZ 기준 (워크플로우에서 `TZ: Asia/Seoul` 보장, 로컬은 이미 KST).

### 1.3 secrets (사용자 작업)

repo Settings → Secrets and variables → Actions에 등록:
`KRA_API_KEY` · `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`

(스크립트가 실제 참조하는 env 키는 구현 시 `.env.example`·코드에서 재확인해 워크플로우에 매핑.)

## 2. L-004 알림

- **기본**: 워크플로우 실패 → GitHub이 계정 이메일로 자동 통지. 구현 0줄.
- **조용한 실패 방어 (0건 검사)**: sync 스크립트가 exit 0이어도 처리 건수 0이면 잡을 실패 처리.
  - 구현: 스크립트 stdout의 처리 건수 요약을 워크플로우 스텝에서 검사하거나, 스크립트에 `--fail-on-empty` 플래그 추가 중 구현 시 단순한 쪽 선택. 판정 기준 = "upsert 대상 경주 0건".
  - 휴장일(혹서기 등)엔 오탐 알림 발생 가능 — **"확인 후 무시"로 운영**. 휴장 캘린더 연동은 범위 밖.

## 3. L-003 재학습 정책 (코드 없음 — 문서화만)

1. **동결**: 라이브 사전 예측이 **1개 분기(약 12주) 누적**되고 `probe:v7-accuracy` 첫 판정이 나올 때까지 재학습·승격 금지.
2. **이후 분기 1회 사이클** (전 과정 수동):
   `npm run db:snapshot`(§4) → `learn:candidate` → `db:pull --table model_versions`(벤치는 로컬 미러를 읽는 함정) → `benchmark` → 사용자 판단 → `promote`.
3. 승격 판단은 사람이 — 자동 재학습·자동 승격은 하지 않는다.
4. 기록 위치: TODO.md L-003 갱신 + `docs/status/02-model-benchmark.md` + `docs/accuracy_metrics.md`(판정 주기 언급부).

## 4. L-005 백업

### 4.1 스냅샷 스크립트 (`npm run db:snapshot`)

- `scripts/snapshot_predictions.ts` — `DATABASE_URL` Postgres 직결(egress 무관)로
  `CREATE TABLE predictions_snapshot_YYYYMMDD AS SELECT * FROM predictions`.
- 같은 날 재실행 시 기존 스냅샷 유지(덮어쓰지 않고 안내 후 종료; `--force`로 교체).
- `--prune N`: 최신 N개만 남기고 오래된 스냅샷 테이블 삭제 (기본 실행에선 삭제 없음).
- **복원 절차 문서화** (수동 SQL): 오염 확인 → `predictions`를 스냅샷으로 교체하는 SQL 예시를 pipeline_guide에 수록.
- 용도: 재학습·백필 등 predictions 대량 쓰기 작업 직전 실행 (§3 사이클에 포함).

### 4.2 db:pull 미러 공식화 (문서만)

- DuckDB 로컬 미러(`npm run db:pull`)를 "전 테이블 최후 방어선"으로 명시.
- 한계 명시: 마지막 pull 시점 기준 — pull 이후 변경분은 복원 불가.
- 미러→Supabase 되돌리기 절차(테이블 단위 수동 upsert) 개요 기술.
- 문서 위치: `docs/pipeline_guide.md`(명령·절차) + `docs/status/05-data-infra.md`(현황 한 줄).

## 5. 테스트

- **단위**: raceCardSync 날짜 기본값(+2일, KST 경계 — UTC 자정 부근에서 어긋나지 않는지), 0건 판정 로직.
- **스냅샷**: 로컬 검증 후 실 DB 1회 리허설 (생성→행수 대조→`--prune` 동작).
- **워크플로우**: `workflow_dispatch`로 수동 1회 실행 → 성공 경로 + 고의 실패(secrets 임시 제거 등) 1회로 이메일 수신 확인.
- **회귀**: 기존 전체 테스트 통과, `npm run build` 타입체크 통과.

## 6. 범위 밖

- 카카오/슬랙/텔레그램 알림, 휴장 캘린더 연동
- 자동 재학습·자동 승격
- 주간 pg_dump 클라우드 백업 (③ — 필요 시 후속)
- Supabase free-tier 절전(pause) 자동 감지·해제 — 단, sync 실패 이메일이 간접 감지 역할을 함

## 7. 완료 기준

- [ ] 수·목·금 출마표 sync와 토·일·월 결과 sync가 무인 실행되고, 실패·0건 시 이메일이 온다.
- [ ] TODO L-002~005가 완료 처리되고 관련 문서(pipeline_guide·status 02/05·accuracy_metrics)가 갱신된다.
- [ ] `npm run db:snapshot` 리허설 1회 성공 + 복원 SQL이 문서에 있다.
- [ ] 재학습 동결·분기 사이클 정책이 문서에 명문화된다.

## 8. 참고

- 선행: L-001 (predictions 보존, 2026-07-11) — specs/2026-07-11-v7-live-tracking-design.md
- 스케줄 근거: docs/data_lifecycle.md (수 14:30 발표, 금토일 밤 결과)
- 함정: [[project_race_shape_track]] (benchmark는 로컬 미러 읽음 → db:pull 선행)
