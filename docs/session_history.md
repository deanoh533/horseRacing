# 세션 작업 히스토리

> 시간순 타임라인. 트랙별 상세는 [docs/status/](status/).

---

## 2026-07-06 — 알파 3중 재검증 완전 종결 + 배당 블렌드 후보 보류
오프셋 조건부 로지트(β=0=날배당 재현 자체검증) 프레임으로 "공개피처로 시장 이기나"를 총량·구간분해·비선형(GBT) 3방향에서 최종 재확인 → **전부 음성**(기존 천장 결론 재확인, 이 질문 완전 종결). 별도 질문("배당을 재료로 섞으면 모델 단독보다 나아지나")은 **양성**(연승 적중률 +7.1~11.5%p, ECE 반토막, 강추 픽수 9배↑에 정확도도↑)이었으나, 챔피언전 검증 전 브레인스토밍 중 **당일 win_odds는 경주 1~2시간 전에야 존재**(사전/사후 동일 산식 원칙과 충돌)함을 재확인하고 data.go.kr 공공API 전수조사 → 실시간/예상 배당 공식 API 미확인. **배포 경로 없어 보류.** 신규 코드 `src/engine/eval/offsetClogit.ts`·`src/engine/models/offsetGBT.ts`·probe 6종은 향후 라이브 배당 소스 확보 시 재검토용으로 보존. 상세 → [03-market-edge](status/03-market-edge.md) · [[project_odds_blend_candidate]]

## 2026-06-27 — 선별 ROI 전수조사: 베팅 ROI 갈래 완전 종결
강추 신호로 베팅 시 ROI를 단·연·복승·박스·조건부까지 전수 검증 → **공개정보 ROI 흑자 불가 확정.** 단·연승 −11/−11%·복승 단일 −24%·복승 박스(top3/4) −17/−14%(적중률↑이나 회수배수<1)·확신박스 +9.6%는 단일분기 노이즈·조건부 엣지 0후보. **부수: predictions 테이블 in-sample 누수+중복 행 발견**(거짓양성 +230%·+9.6% 2건을 walk-forward·분기일관성으로 격파). **강추 73% 적중률은 OOS 72.4%로 정직 재확인**(누수 무관). 신규 도구 `probe:picks:roi`·`probe:picks:oos`·`probe:picks:box`. 남은 유일 ROI 길=마체중 직전수집(KRA 직전 API 가용성 미확인). 상세 → [03-market-edge](status/03-market-edge.md) · [[project_selective_picks]] · [[project_market_dominance_ceiling]]

## 2026-06-27 — 문서 통합 2라운드 (섹션 중복 제거)
어제 restructure가 못 잡은 잔여 정리: results_log→modeling-history §1 흡수·_trash 격리, modeling-history §3→feature_hypotheses SSOT 링크, data_flow 중복 섹션 2개(DB표·운영시나리오)→정본 링크 축소. **6 카테고리 SSOT 유지 맵**을 [[project_docs_architecture]]에 고정. 결론: 합칠 전체 파일 쌍 없음(strategy 16/17·요약/세부는 보존이 맞음). 상세 → [[project_docs_architecture]]

## 2026-06-25 — 선별 표시·베팅 (트랙 C)
강추/주목 라벨 + `/picks` 뷰 + 통계 섹션 배포. 상세 → [03-market-edge](status/03-market-edge.md) · [[project_selective_picks]]

## 2026-06-22 — 라이브 흐름 실습 검증
sync:cards 사전예측이 predictions에 Platt 확률 포함 정상 기록 확인(actual=NULL 사전모드). 상세 → [05-data-infra](status/05-data-infra.md) · [03-market-edge](status/03-market-edge.md)

## 2026-06-20 — Platt 라이브 배포 + 조교 376k 업로드
Platt 캘리브레이션(p_win/p_top3) 라이브 배포 완료 + training_logs 6,540→376,372행 upload. 상세 → [03-market-edge](status/03-market-edge.md) · [05-data-infra](status/05-data-infra.md)

## 2026-06-19 — 조교 신호 흡수 확정 + Platt 코드 완료
통제 A/B(같은 스펙 ON/OFF) Δ−0.12% = 조교 train_signal 흡수, 채택 X. Platt 라이브 코드·fit 완료. 상세 → [04-signals](status/04-signals.md) · [03-market-edge](status/03-market-edge.md)

## 2026-06-18 — Benter 2단계 음성 종결 + 조교 backfill 착수
Benter 2단계 "실재하나 무가치한 엣지" 완전종결 + 친구 키로 조교 로그 backfill. 상세 → [03-market-edge](status/03-market-edge.md) · [04-signals](status/04-signals.md)

## 2026-06-16 — 공개피처 발굴 종결 + ⑲ 스코어맵 종결
공개피처 3건 음성 종결, 방법론 전환(4갈래). ⑲ SCORE_MAP=죽은코드 종결. 상세 → [01-scoring](status/01-scoring.md) · [03-market-edge](status/03-market-edge.md)

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
