# 세션 작업 히스토리

> 시간순 타임라인. 트랙별 상세는 [docs/status/](status/).

---

## 2026-06-25 — 선별 표시·베팅 (트랙 C)
강추/주목 라벨 + `/picks` 뷰 + 통계 섹션 배포. 상세 → [03-market-edge](status/03-market-edge.md) · [[project_selective_picks]]

## 2026-06-14 — 롤링 벤치마크 통합
benchmark ← walkforward 흡수·삭제. 상세 → [02-model-benchmark](status/02-model-benchmark.md) · [[project_rolling_benchmark_integration]]

## 2026-06-12 — 파이프라인 문서화
data_flow.md 재작성 + pipeline_guide.md 신규 + accuracy_metrics.md 확장 + 문서 갱신 규칙 확립. 상세 → [05-data-infra](status/05-data-infra.md) · [[reference_pipeline_guide]]

## 2026-06-12 — Multi-Model Benchmark 구현
`benchmark_all.ts` 신규(560줄), ReadClient 추상화, `npm run benchmark` 등록. 상세 → [02-model-benchmark](status/02-model-benchmark.md)

## 2026-06-11 — class_move promote + PL 폐기 + 패리티 버그
class_move 채택(+3.9%p), PL 폐기, scorePredictor 1000행 패리티 버그 수정. 상세 → [04-signals](status/04-signals.md) · [02-model-benchmark](status/02-model-benchmark.md)

## 2026-06-10 — 복승 박스 타깃 + 2단계 게이트
2단계 게이트 표준화 + class_move 채택(+2.2%p, 라이브 클린). 상세 → [04-signals](status/04-signals.md) · [[project_feature_gate_findings]]

## 2026-06-06 — 재설계 최종값 + earnings 종결
로지스틱 연승 59.0% 확정. earnings 미래누수 확정(예측력 0). 상세 → [01-scoring](status/01-scoring.md) · [[reference_earnings_asof_leak]]

## 2026-06-03 — 속도능력지수 + 시장 벤치마크
⑳ 속도능력지수 추가(ρ=0.271, v3 미승격). 시장 벤치마크 음성지식 발견. 상세 → [02-model-benchmark](status/02-model-benchmark.md) · [[project_market_benchmark]]

## 2026-06-02 — 가중치 버전관리 + 누수 수정
look-ahead 누수 수정(옛 적중률=거짓, 복승 ~58%). model_versions 테이블 도입. 상세 → [01-scoring](status/01-scoring.md) · [[project_weight_versioning]]
