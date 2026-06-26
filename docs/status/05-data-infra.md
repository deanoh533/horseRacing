# 데이터인프라 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_duckdb_local_mirror]], [[feedback_local_first_over_db]], [[reference_pipeline_guide]], [[reference_api_spec_doc]], [[reference_kra_dividend_api]], [[reference_earnings_asof_leak]], [[reference_db_schema_gotchas]]

## 현재 상태
- **DuckDB 로컬 미러** 배포 — Supabase egress 영구 탈출, 오프라인 분석 전용(benchmark·backtest·probe 전부). `npm run db:pull`로 동기화.
- **Supabase egress** — REST/웹앱만 영향. `DATABASE_URL` Postgres 직결(db:pull·SQL·upsert)은 egress 무관.
- **조교 로그 376k** — `npm run training:upload`(JSONL→Supabase 멱등 upsert)로 6,540→376,372행.

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
- 🔲 런치 게이팅 (운영 전환 필수): prediction_logs 분리 / sync 자동화 / 재학습 주기 정책 / 에러 알림 / DB 백업 → TODO L-001~005
- 🔲 외부 데이터 출처 검토 (조교상태·마필가격·복기평·경주로 빠르기) → TODO T-013
- 🔲 win_odds 시계열 캡처 (경주 직전 변동) → TODO P3
- 🔲 복승 배당 결손 보충 — 2026-05-10~06-05 미수집
- 🔲 model_versions 스키마 영구화 (→ [02-model-benchmark](02-model-benchmark.md))

## 종결·기각 (요약)
- ✅ DuckDB 로컬 미러 + db:pull (2026-06-12 설계 → 배포). [[project_duckdb_local_mirror]]

## 참고
- 문서: [data_flow.md](../data_flow.md), [pipeline_guide.md](../pipeline_guide.md), [api_spec.md](../api_spec.md), [kra_api_quirks.md](../kra_api_quirks.md)
- 할일: [TODO.md](../../TODO.md) (L-001~005·T-013)
