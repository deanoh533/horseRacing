# 데이터인프라 — 진행 상황
> 마지막 업데이트: 2026-08-23 · 관련 메모리: [[project_duckdb_local_mirror]], [[feedback_local_first_over_db]], [[reference_pipeline_guide]], [[reference_api_spec_doc]], [[reference_kra_dividend_api]], [[reference_earnings_asof_leak]], [[reference_db_schema_gotchas]]

## 현재 상태
- **DuckDB 로컬 미러** 배포 — Supabase egress 영구 탈출, 오프라인 분석 전용(benchmark·backtest·probe 전부). `npm run db:pull`로 동기화.
- **Supabase egress** — REST/웹앱만 영향. `DATABASE_URL` Postgres 직결(db:pull·SQL·upsert)은 egress 무관.
- **조교 로그 376k** — `npm run training:upload`(JSONL→Supabase 멱등 upsert)로 6,540→376,372행.
- **sync 자동화 + 백업 (L-002~005, 2026-07-12)** — Actions cron(출마표 수목금 15시·결과 금토일 19시 KST → **2026-08-22부터 19시+23시 2슬롯**, 실패·0건 이메일) + `db:snapshot`. 절차: [pipeline_guide.md](../pipeline_guide.md).
- **KRA 클라이언트 재시도 + 결과 sync 시각 변경 (2026-07-29)** — 무인 결과 sync가 KRA 결과 API 응답 지연으로 `timeout of 30000ms` 한 번에 배치 전체 실패(로컬은 정상 = 러너 간헐 지연 + 재시도 부재). ① `KRAClient`에 지수 백오프 재시도(4회·1s→2s→4s) + 타임아웃 30→60초(모든 엔드포인트 `getWithRetry` 경유), ② 결과 cron **토일월 01:00 → 금토일 19:00 KST**(당일 저녁, `--date $(date +%Y%m%d)`로 "오늘" 수집). ⚠️ 리스크: 19:00에 막판 경주 결과가 KRA에 아직 없을 수 있음(과거 01:00은 전 경주 확정 보장) → 다음 주말 실측 관찰. `if:` cron 매칭 문자열도 `0 10 * * 5,6,0`로 동시 변경.
- **✅ 무인 운영 진입 (2026-07-15)** — secrets 5종 등록 후 수요일 15:00 첫 스케줄 실행 성공, 사이트에서 신규 출마표 확인. 남은 관찰: 주말 결과 sync(금토일 19:00, 재시도 탑재) 실측 성공 + 막판 경주 결과 누락 여부 + v7 라이브 적중률 누적.
- **출마표 cron 주말 3일치 일괄 (2026-07-22)** — 출마표는 수요일에 금·토·일 동시 발표 → `upcomingCardDates()`로 각 실행이 "발표일+2~일요일" 남은 경주 전체 수집(수=금토일·목=토일·금=일). 수요일 조기 노출+목금 재실행 임박 갱신. cron 스케줄 불변, `--date` 명시 시 단일. [[project_launch_gating_ops]].
- **수동 동기화 = 실제 실행 (2026-07-22, 라이브 검증)** — Vercel Edge 함수 `api/sync.ts`가 GitHub workflow_dispatch 대리 호출(설정탭 버튼). 게이트=`x-sync-key`==env `SYNC_SECRET`, 토큰=env `GH_DISPATCH_TOKEN`(둘 다 Vercel env, 번들 밖). 로컬 dev엔 /api 없어 배포본 전용. `typecheck:api`·vercel.json rewrite `/api` 제외 필수.
- **races 출마표 컬럼 보존 + 스키마 드리프트 해소 (2026-08-23)** — 경주별 결과 sync 검토 중 발견: 결과 sync의 `toRaceRow()`가 `st_time: null, chaksun4: null, chaksun5: null`을 명시해 **출마표 sync가 채운 발주시각·4·5착 상금을 결과 도착과 동시에 전멸**시키고 있었다(8월 105경주 중 결과 전인 당일 17건만 생존). 결과 API(API214_1)엔 이 세 컬럼이 없으므로 **반환 객체에서 키를 빼서** PostgREST upsert의 SET 절에 안 들어가게 수정 → 기존 값 보존(임시 행으로 실 DB 검증 완료). 컬럼 3종이 실 DB에만 있고 마이그레이션엔 없던 드리프트도 `017_races_entrysheet_columns.sql`로 편입. **발주시각 실측(2026-08-23 17경주)**: 형식 `"출발 :HH:MM"` 단일·파싱 실패 0건이나 **경주 간격 25~80분 불규칙**. 실제 발주시각(지연 반영분)은 KRA 미제공.
- **⚠️ Actions schedule cron 지연 실측 (2026-08-23)** — 스케줄 실행 35건 기준 **중앙값 +62분, 범위 +19~+144분, 정시 실행 0건**. 60분 초과가 19/35건. → **경주별(경주 종료 직후) sync는 Actions `schedule`로 불가능**. 정밀 타이밍이 필요하면 1회 실행 후 job 내부 sleep 루프(러너 시계) 방식이어야 한다(저장소 public이라 러너 시간 무료, 단 job 6시간 상한 < 경마 7시간+).
- **결과 sync 2차 슬롯 + 휴장일 오탐 제거 + 타임아웃 강화 (2026-08-22)** — 3주 Actions 이력 점검 결과 **결과 3일치 구멍**(20260808·0814·0821: 출전표·예측은 있고 `ord`·조합배당 0). 원인은 전부 KRA API 타임아웃 60s×4회 전멸 — 출마표는 수·목·금 3회라 자가복구됐지만 결과는 하루 1회뿐이라 실패가 곧 영구 구멍. ① 결과 cron에 **23:00 KST 2차 슬롯**(`0 14 * * 5,6,0`) 추가 — 19시 막판 경주 미확정 리스크(2026-07-29 기재)도 같이 해소, upsert 멱등이라 1차 성공 시 무해. ② `emptySyncVerdict()`로 `--fail-on-empty`가 **휴장일(0건+에러0 → 정상 종료)과 장애(0건+에러 → exit 1)를 구분** — 혹서기 휴장 7/31~8/2 빨간불 오탐 제거. ③ KRA 클라이언트 타임아웃 60→120초·재시도 4→5회, job `timeout-minutes` 90/45 명시. ✅ 구멍 3일치는 자동 복구 대상이 아니라 **사용자 수동 백필로 복구 완료(2026-08-23** — `npm run sync -- --date 20260808`·`0814`·`0821`**)**. 구멍 확인법: 해당 날짜 `race_entries.ord` NOT NULL 건수 대조.
- **⚠️ 미시행 경주 ord=0 오염 + 가드 (2026-08-23)** — 8/22 서울 R9·R10 결과가 UI에 **"0위"** 로 표시되는 것에서 발견. KRA 결과 API는 **아직 치르지 않은 경주도 행으로 내려주는데 `ord=0`·`rcTime=0`·`weather=null`·`track=''`** 이다. `toRaceEntryResultRow`의 ord 가드가 **상한(`<90`=실격·기권 코드)만 있고 하한이 없어** 0이 그대로 저장 → ① UI "0위" ② `actual_ord <= 3` 적중률 필터에 **0이 적중으로 잡혀 통계 부풀림**. 원인은 **19시 슬롯 × 야간경마 막판 경주**로, 오염 5경주(20251226 부경 R6 / 20260815·20260822 서울 R9·R10, 48행)가 전부 이 패턴. 8/22은 23시 2차 슬롯이 **워크플로 푸시(23:56 KST = 14:56 UTC)가 크론(14:00 UTC)보다 늦어** 그날 안 돌아 복구 기회가 없었음. 수정: ① `ord > 0` 하한 가드(transformer) ② dailySync **미시행 경주 통째 스킵**(`racesSkipped`) — 저장 시 races 메타가 빈값으로 덮이고 combo_dividends에 **확정배당 아닌 발매 중 예상배당**이 들어가므로 ③ `emptySyncVerdict`에 `pending` 추가 — 전 경주 스킵을 "휴장일"로 거짓 보고하지 않게. ⚠️ 오염 48행은 코드로 자동 복구 안 됨 → 해당 3일 재싱크 + 잔존 0 정리 필요.
- **부분 결과 감지 + 전체 구멍 백필 + KRA 장애 원인 확정 (2026-08-28)** — `probe:sync-health`가 **`ordFilled === 0`만 구멍으로 봐서 10경주 중 8경주만 온 날을 ✅ 정상으로 통과**시키고 있었다(실측 20260822·20260815, 둘 다 서울 R9·R10 결측). `ordFilled < entries`는 제외마 때문에 매일 오탐이라 **경주 단위 대조**로 교체 — `RaceDateCounts.racesWithResult`(결과 있는 meet-rc_no distinct) < `races` → 새 상태 `gap`(❗)을 `hole`과 함께 백필 명령에 포함. distinct는 PostgREST가 못 하니 (경주일·경마장·경주번호)만 페이지네이션으로 받아 센다. 전체 스캔(`--from 20251220`)에서 **20260627·20260628도 완전 구멍**으로 추가 발견(이전 점검은 8/1 이후만 봐서 놓침).

  **재싱크 백필(같은 날 실행)**: `20260823`(완전 구멍 176두)·`20260822`·`20260815`(경주 일부 구멍)·`20260627`·`20260628`(신규 발견) 전부 ✅ 정상 확정. **Actions 이력 전체 대조로 장애 성격 정정**: 8/23 10:26·14:17 UTC 결과(API214_1) 타임아웃 → 8/26 06:22 UTC 출마표(API26_2)는 정상 → 8/27 16:52 UTC 출마표(API26_2) 다시 타임아웃 → 8/28 수동 백필 정상. **"그날 한정 장애"가 아니라 8/23~8/27 사이 간헐적으로 재발한 KRA 서버 전반의 불안정**(결과·출마표 두 엔드포인트 모두 영향). 확정된 사실: **타임아웃 60→120초 상향은 이 장애 유형에 무효**이고 백오프 1→2→4→8초=~10분 총 스팬이라 장애 창을 못 넘긴다. 슬롯 내 재시도 강화(3차 슬롯·백오프 확대)는 다일 간헐 장애엔 근본적으로 안 맞음.

- **결과 수신을 발주시각 기반 폴러로 재설계 + 캐치업 분리 (2026-08-29, feat/results-poller)** — O-003 최종 결론: 고정 19시·23시 슬롯을 폐지하고 ① **결과 폴러**(`scripts/resultsPoll.ts`) 경주 있는 날 KST 10:00~21:45·15분 간격, 출마표 발주시각(`races.st_time`, "출발 :HH:MM")+15분이 지났는데 착순 없는 경주가 있을 때만 KRA 호출(없으면 DB 조회만 하고 종료 — KRA 쿼터 절약) ② **캐치업**(`scripts/catchupSync.ts`) 폴러와 독립적으로 매일 KST 07:00, 최근 7일 hole·gap을 `classifyRaceDate`로 찾아 자동 재싱크 — 폴러가 그날 전멸해도 다음날 자동 복구. 순수 판정 `src/sync/resultsPollLogic.ts`(11 테스트)·`src/sync/catchupLogic.ts`(3 테스트), DB 조회는 `probe_sync_health.ts`와 공유(`src/sync/syncHealthQuery.ts`)로 중복 제거. 알림은 캐치업이 **2일 이상 묵은 구멍을 이번 시도로도 못 채웠을 때만** 실패 처리(L-004 유지, 매 폴 실패마다 오던 옛 소음 제거). 퍼블릭 레포 확인(`gh repo view` → PUBLIC) → Actions 분 무제한이라 15분 간격 비용 우려 없음.

  ⚠️ **알려진 한계**: 위 §"Actions schedule cron 지연 실측(2026-08-23)"에 이미 기록된 대로 `schedule` 트리거는 지연 중앙값 +62분·정시 실행 0건 — 15분 간격으로 등록해도 **정확히 15분마다 확인된다는 보장은 없다**. 슬롯이 많아(하루 최대 47개) 전체적으로는 기존 고정 2슬롯보다 훨씬 자주 확인되지만, "경주 끝나자마자 정확히"는 아닐 수 있음을 인지하고 채택(정밀 타이밍이 필요하면 러너 내부 sleep 루프 방식이 대안이나, job 6시간 상한 < 경마 스팬이라 별도 설계 필요 — 보류).

  **`20251226` 부경 R6은 영구 미해결**로 남는다 — 재싱크해도 KRA가 `⏭ 미시행·결과 미확정 → 스킵`을 반환(실제 취소 경주). `dailySync`의 미시행 가드(`ord>0` 유무)와 KRA 응답 어디에도 "일시적 지연 vs 영구 취소"를 구분할 신호가 없음(`ordBigo` 등 상태 필드 미제공) → `probe:sync-health`가 이 날짜를 앞으로도 계속 gap으로 표시한다. 1건짜리 예외로 판정 로직에 휴리스틱을 넣지 않고 알려진 예외로만 기록.

- **조합 확정배당 수집 (2026-07-29)** — 결과 sync(dailySync)가 경주 결과 저장 직후 `API160_1/integratedInfo_1`에서 조합배당(복승·복연승·쌍승·삼복승·삼쌍승)을 받아 `combo_dividends`(migration 015)에 멱등 upsert. forward만(skipPredictions=false), 실패 격리. 단승/연승은 race_entries에 이미 존재. 과거 백필·DuckDB 미러 반영은 별도. 스펙/플랜 docs/superpowers/*/2026-07-29-combo-dividends-sync*.

### DB 현황
| 테이블/뷰 | rows | 기준 |
|---|---|---|
| race_entries | 37,453 | 2026-05-30 |
| races | 3,585 | 2026-05-30 |
| predictions | 39,331 (p_win/p_top3 100%) | 2026-06-20 |
| training_logs | 376,372 | 2026-06-20 |
| jockey_stats | 59 (서울 34·부경 25) | 2026-05-30 |
| horses | 2,864 (모두 혈통 있음) | 2026-05-30 |
| combo_dividends | (신규) | 2026-07-29~ |

서울 구간기록 backfill: 2024 100% / 2025 97.3% / 2026 97.9% (부경 99.9%) — 에러 ~3%는 KRA 원천 없음.

## 다음 후보·남음
- 🔲 외부 데이터 출처 검토 (조교상태·마필가격·복기평·경주로 빠르기) → TODO T-013
- 🔲 win_odds 시계열 캡처 (경주 직전 변동) → TODO P3
- 🔲 복승 배당 결손 보충 — 2026-05-10~06-05 미수집
- 🔲 model_versions 스키마 영구화 (→ [02-model-benchmark](02-model-benchmark.md))

## 종결·기각 (요약)
- ✅ DuckDB 로컬 미러 + db:pull (2026-06-12 설계 → 배포). [[project_duckdb_local_mirror]]
- ✅ 런치 게이팅 L-001~005 완료 (2026-07-11~12) — predictions 보존 전략(L-001) + sync 자동화·재학습 동결 정책·에러 알림·DB 백업(L-002~005). 상세: [TODO.md](../../TODO.md), [pipeline_guide.md](../pipeline_guide.md).

## 참고
- 문서: [data_flow.md](../data_flow.md), [pipeline_guide.md](../pipeline_guide.md), [api_spec.md](../api_spec.md), [kra_api_quirks.md](../kra_api_quirks.md)
- 할일: [TODO.md](../../TODO.md) (L-001~005·T-013)
