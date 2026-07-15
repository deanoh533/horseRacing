# 데이터인프라 — 진행 상황
> 마지막 업데이트: 2026-07-15 · 관련 메모리: [[project_duckdb_local_mirror]], [[feedback_local_first_over_db]], [[reference_pipeline_guide]], [[reference_api_spec_doc]], [[reference_kra_dividend_api]], [[reference_earnings_asof_leak]], [[reference_db_schema_gotchas]]

## 현재 상태
- **DuckDB 로컬 미러** 배포 — Supabase egress 영구 탈출, 오프라인 분석 전용(benchmark·backtest·probe 전부). `npm run db:pull`로 동기화.
- **Supabase egress** — REST/웹앱만 영향. `DATABASE_URL` Postgres 직결(db:pull·SQL·upsert)은 egress 무관.
- **조교 로그 376k** — `npm run training:upload`(JSONL→Supabase 멱등 upsert)로 6,540→376,372행.
- **sync 자동화 + 백업 (L-002~005, 2026-07-12)** — Actions cron(출마표 수목금 15시·결과 토일월 새벽 1시 KST, 실패·0건 이메일) + `db:snapshot`. 절차: [pipeline_guide.md](../pipeline_guide.md).
- **✅ 무인 운영 진입 (2026-07-15)** — secrets 5종 등록 후 수요일 15:00 첫 스케줄 실행 성공, 사이트에서 신규 출마표 확인. 남은 관찰: 주말 결과 sync(토일월 01:00) 첫 실행 + v7 라이브 적중률 누적.

### DB 현황
| 테이블/뷰 | rows | 기준 |
|---|---|---|
| race_entries | 37,453 | 2026-05-30 |
| races | 3,585 | 2026-05-30 |
| predictions | 39,331 (p_win/p_top3 100%) | 2026-06-20 |
| training_logs | 376,372 | 2026-06-20 |
| jockey_stats | 59 (서울 34·부경 25) | 2026-05-30 |
| horses | 2,864 (모두 혈통 있음) | 2026-05-30 |

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
