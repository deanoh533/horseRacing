# 데이터인프라 — 진행 상황
> 마지막 업데이트: 2026-07-29 · 관련 메모리: [[project_duckdb_local_mirror]], [[feedback_local_first_over_db]], [[reference_pipeline_guide]], [[reference_api_spec_doc]], [[reference_kra_dividend_api]], [[reference_earnings_asof_leak]], [[reference_db_schema_gotchas]]

## 현재 상태
- **DuckDB 로컬 미러** 배포 — Supabase egress 영구 탈출, 오프라인 분석 전용(benchmark·backtest·probe 전부). `npm run db:pull`로 동기화.
- **Supabase egress** — REST/웹앱만 영향. `DATABASE_URL` Postgres 직결(db:pull·SQL·upsert)은 egress 무관.
- **조교 로그 376k** — `npm run training:upload`(JSONL→Supabase 멱등 upsert)로 6,540→376,372행.
- **sync 자동화 + 백업 (L-002~005, 2026-07-12)** — Actions cron(출마표 수목금 15시·결과 금토일 19시 KST, 실패·0건 이메일) + `db:snapshot`. 절차: [pipeline_guide.md](../pipeline_guide.md).
- **KRA 클라이언트 재시도 + 결과 sync 시각 변경 (2026-07-29)** — 무인 결과 sync가 KRA 결과 API 응답 지연으로 `timeout of 30000ms` 한 번에 배치 전체 실패(로컬은 정상 = 러너 간헐 지연 + 재시도 부재). ① `KRAClient`에 지수 백오프 재시도(4회·1s→2s→4s) + 타임아웃 30→60초(모든 엔드포인트 `getWithRetry` 경유), ② 결과 cron **토일월 01:00 → 금토일 19:00 KST**(당일 저녁, `--date $(date +%Y%m%d)`로 "오늘" 수집). ⚠️ 리스크: 19:00에 막판 경주 결과가 KRA에 아직 없을 수 있음(과거 01:00은 전 경주 확정 보장) → 다음 주말 실측 관찰. `if:` cron 매칭 문자열도 `0 10 * * 5,6,0`로 동시 변경.
- **✅ 무인 운영 진입 (2026-07-15)** — secrets 5종 등록 후 수요일 15:00 첫 스케줄 실행 성공, 사이트에서 신규 출마표 확인. 남은 관찰: 주말 결과 sync(금토일 19:00, 재시도 탑재) 실측 성공 + 막판 경주 결과 누락 여부 + v7 라이브 적중률 누적.
- **출마표 cron 주말 3일치 일괄 (2026-07-22)** — 출마표는 수요일에 금·토·일 동시 발표 → `upcomingCardDates()`로 각 실행이 "발표일+2~일요일" 남은 경주 전체 수집(수=금토일·목=토일·금=일). 수요일 조기 노출+목금 재실행 임박 갱신. cron 스케줄 불변, `--date` 명시 시 단일. [[project_launch_gating_ops]].
- **수동 동기화 = 실제 실행 (2026-07-22, 라이브 검증)** — Vercel Edge 함수 `api/sync.ts`가 GitHub workflow_dispatch 대리 호출(설정탭 버튼). 게이트=`x-sync-key`==env `SYNC_SECRET`, 토큰=env `GH_DISPATCH_TOKEN`(둘 다 Vercel env, 번들 밖). 로컬 dev엔 /api 없어 배포본 전용. `typecheck:api`·vercel.json rewrite `/api` 제외 필수.
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
