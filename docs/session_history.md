# 세션 작업 히스토리

> 시간순 타임라인. 트랙별 상세는 [docs/status/](status/).

---

## 2026-07-12~13 — L-002~005 완료: 런치 게이팅 운영 기반 (main 머지 48c6f6d)
브레인스토밍(버튼 결정 4건: Actions cron / 동결→분기1회 / GitHub 이메일 / 스냅샷+미러)→스펙→플랜→SDD 7 Task로 런치 게이팅 잔여 4항목 종결. ① `src/utils/syncCli.ts` 순수 헬퍼(TDD) ② raceCardSync **날짜 기본값 오늘+2일**(발표일+2 도메인 규칙 코드화)+`--fail-on-empty`+`--date` 검증(리뷰가 잡은 회귀: 오타가 조용히 자동날짜로 대체) ③ dailySync 동일 와이어링 ④ `db:snapshot`(predictions→snapshot_YYYYMMDD, --force/--prune, **실DB 리허설 40,515행 행수일치**) ⑤ `.github/workflows/sync.yml` — 출마표 수목금 15:00·결과 토일월 01:00 KST, 함정 2개 명시(`TZ: Asia/Seoul`·`DB_SOURCE: supabase`), workflow_dispatch ⑥ 문서 6종(TODO L-002~005 완료·pipeline_guide §9·status 02/05·accuracy_metrics·CLAUDE.md) ⑦ 최종 whole-branch 리뷰 **머지가능(Critical/Important 0)**. 재학습 동결 정책 명문화: v7 라이브 1분기+첫 판정까지. 테스트 470 통과. **남은 사용자 작업**: repo secrets 5종 등록(ANTHROPIC_API_KEY 포함 — env 스키마 요구)·dispatch 리허설·수요일 첫 스케줄 확인. 상세 → [05-data-infra](status/05-data-infra.md) · [[project_launch_gating_ops]]

## 2026-07-11 — L-001 완료: v7 라이브 적중률 추적 (predictions 보존 방식)
prediction_logs 테이블 신설(원설계) 대신 **predictions 쓰기 경로 변경**으로 대체 구현, SDD(태스크별 서브에이전트+이중 리뷰)로 커밋 10개 push. ① `forcePrecompetition` 옵션(ord만 스크럽 — wg_hr 미스크럽은 문서화된 한계) ② dailySync: DELETE→INSERT 제거 → 없는 경주만 사전모드 보충 + **actual_ord만 UPDATE**(기존 적중률 화면 유지, 사용자 결정) ③ /picks `race_date=오늘` 단일 필터(−7일 방어필터 폐기, 당일만 표시=확인된 의도) ④ `probe:v7-accuracy`(race_entries.ord 조인·model_version별·config 임계 단일출처, **db:pull 선행**) ⑤ 수→금→판정 통합테스트+문서 6종 ⑥ 최종 전체리뷰(Opus) I-1 픽스: **raceCardSync 결과도착 가드**(재실행 시 사전 스냅샷 덮임 지뢰 차단)+stale status 3종 정정. 테스트 458 통과. 다음: 주말 결과 수집 → 차주 첫 라이브 판정 + L-002~005 스펙 착수(`docs/superpowers/specs/2026-07-11-launch-gating-ops-design.md` 승인됨). 상세 → [02-model-benchmark](status/02-model-benchmark.md) · [[project_v7_live_tracking]]

## 2026-07-10 — v7-shape 승격: 전개 피처 라이브 반영 완료
t3 채택 후속 promote 사이클. ① 학습행렬 2022~ 재추출(82,716행, shape 피처 as-of 포함) ② v7-shape 후보 등록(id=7, 피처 108 — Sonnet 서브에이전트 위임, 벤치마크가 읽는 로컬 미러에 후보 없던 블로커는 `db:pull --table model_versions`로 해결) ③ 검증 벤치 v7 61.9% vs v6 61.6%(in-sample 새너티, 이상 없음) ④ **promote 활성 전환**(서브에이전트는 프로덕션 변경 거부 → 메인에서 사용자 승인 하에 실행; DATABASE_URL 경로가 재생성 생략하나 대상 없음 — 6/27-28 v6 사전기록 보존이 오히려 정직) ⑤ Platt 재적합(platt3 a=1.057·b=0.047 near-identity) ⑥ probe:picks 임계 0.72/0.62 유효 재확인. 다음: 주말 sync:racecard부터 v7 예측 시작, 라이브 적중률 추적. 상세 → [02-model-benchmark](status/02-model-benchmark.md) · [04-signals](status/04-signals.md)

## 2026-07-09 (저녁) — 전개 shape_signal t3 사전등록 판정: ✅ 채택
db:pull 후 후속 세션. ① 2022~23 백필 G3F 커버리지 검증 — 전 구간 100%·값 새너티 통과(2022~23 중앙값 차이는 거리 구성 탓, 거리당 정규화 시 동일). ② t3 사전등록 스펙 커밋(판정=2024H2 무오염 신선 구간 단독, Logistic(t3) 연승 Δ≥+0.5%p AND 2분기 양수 — 사용자 버튼 확정). ③ benchmark `--from/--to/--first-test/--gate-holdout` 파라미터화(무플래그=기존 불변, 게이트B holdout 0경주 블로커 발견→2024Q2로 확정). ④ **판정 런: OFF 58.2% → ON 60.3% = Δ+2.1%p, 2024Q3 +1.7/2024Q4 +2.4 모두 양수 → 채택.** 참고 진단 전 모델 방향 일치(GBDT(t3) +5.6%p·Logistic(t2) +1.1%p·PL +0.6%p) — 학습구간이 2022~로 길어지자 t2도 양수 전환. 다음: promote·라이브 반영 사이클(라벨 선택 포함). 상세 → [04-signals](status/04-signals.md) · 스펙 `docs/superpowers/specs/2026-07-09-race-shape-t3-prereg.md`

## 2026-07-07~09 — 경주 전개(race shape) 트랙: probe → 피처화 → A/B 미채택 → 학습구간 확장
"시장이 아니라 공개데이터 활용을 재검증하자"는 관점 전환에서 출발. ① `probe:shape` H1~H9 실측 — 선두권 우승점유 56.6%, G3F 격차 단조, **H5/H6 필요속도 달성확률이 역전율 3~6배(최강)**, H9 완전 사전(as-of) 재현에서도 칸 분리 절반 생존(코너 간 4.8배). ② 스펙→플랜→서브에이전트 SDD로 피처 2종(`shape_pred_gap`·`shape_p_achieve`, id `shape_signal`) 구현 + benchmark `--include/--exclude` 통제 A/B 인프라. ③ **판정 미채택**: 사전등록 지표 Logistic(t2) Δ+0.2%p < 합격선 +0.5%p. 단 **t3 라벨 계열 일관 양수**(Logistic(t3) +1.5%p 5/6분기·GBDT(t3) +2.1%p) = 도메인 정합 후속 후보. ④ 후속 준비: `backfill:results` 신설(+`skipPredictions`) → **2022-01~2024-05 백필 완료(+4,110경주, 총 ~4.5년)** + db:pull 완료. Supabase free-tier pause 사건(Resume로 복구). 다음 세션 = 2022~23 G3F 커버리지 검증 → t3 사전등록 스펙 커밋 → 2024H2 시험구간 벤치마크 → 판정. ⚠️ 재구성 시 `FIRST_TEST`/`SHAPE_PAR_CUTOFF`(현재 20250101 하드코딩) 파라미터화 필요. 상세 → [04-signals](status/04-signals.md) · [[project_race_shape_track]]

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
