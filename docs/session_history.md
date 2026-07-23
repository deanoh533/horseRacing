# 세션 작업 히스토리

> 시간순 타임라인. 트랙별 상세는 [docs/status/](status/).

---

## 2026-07-22~23 — 무인 cron 주말 일괄 + 설정탭 재작성 + 수동 동기화 실제 실행 (main 머지 2b992d4)
운영 편의 3연작(각각 브레인스토밍→스펙→플랜→구현, 전부 main 머지·푸시). ① **출마표 cron 주말 3일치 일괄** — 출마표는 수요일에 금·토·일 동시 발표되는데 `sync:cards` 기본값이 오늘+2 단일 날짜라 cron이 수목금 하루씩만 긁던 문제 → `upcomingCardDates()`(src/utils/syncCli.ts, 테스트)로 각 실행이 "발표일+2 ~ 이번 주 일요일" 남은 경주 전체를 받게(수=금토일·목=토일·금=일). cron 스케줄 불변, 재실행은 upsert 멱등+L-001 가드가 사후 스냅샷 보호. ② **설정탭 정직한 재작성** — 거의 전부 죽은 목업(v5.1·2026-05-22)이던 Settings.tsx를 실현황으로 교체: 활성 모델(useActiveModelVersion)·동기화 현황(신규 `useSyncStatus`: 최신 출마표 경주일·누적 경주수·결과 경주일·마지막 수집시각)·학습 동결 정책·자격증명 안내. API키편집·인사이트4선택·알림·내보내기·초기화·테마 목업 전부 제거. ③ **수동 동기화 = 실제 실행** — 딥링크(Actions 페이지 열기)에서 업그레이드: **Vercel Edge 함수 `api/sync.ts`**가 GitHub workflow_dispatch 대리 호출(정적 클라는 토큰 못 들어서). 게이트=헤더 `x-sync-key`==env `SYNC_SECRET`, 토큰=env `GH_DISPATCH_TOKEN`(번들 밖). 설정탭 버튼(출마표/결과 실행)+암구호(localStorage). 순수파서 parseSyncBody 테스트·`typecheck:api`·vercel.json rewrite `/api` 제외. **사용자 셋업(PAT Actions:R/W·Vercel env 2개·암구호 입력) 후 라이브 검증 완료.** 로컬 dev엔 /api 없어 배포본 전용. 테스트 528 통과. 상세 → [05-data-infra](status/05-data-infra.md) · [06-ui](status/06-ui.md) · [[project_launch_gating_ops]]

## 2026-07-18~20 — F-004 /insights H7 교차표 (main 머지 f5829be)
전개 트랙 이월 항목 1단계. probe H9 SQL을 문자 단위 전사한 `export:h7`로 12칸 실측표(2022.2~2026.6, 56,645출주)를 정적 JSON으로 굳혀 새 페이지 `/insights`에 노출 — 격차 0.5초 미만×달성확률 높음 승률 18.9% vs 1.5초+×낮음 3.3%(5.7배), 양축 완전 단조 재현. 리뷰가 DuckDB 병렬 동률 비결정성을 발견 → `SET threads TO 1`로 JSON 재현성 확보. 말별 매핑(서버 저장 필요)은 범위 밖으로 이월. 상세 → [06-ui](status/06-ui.md)

## 2026-07-16~17 — F-001 페이스 배지 + /picks 주간 강추 전환 (main 머지 6845a67)
① **F-001 페이스 예측 UI** — 기각 종결 후 순수 UI로 재개. `lib/pace.ts`(서버 computePaceType 동일 규칙 + 데이터 절반 미만 판정불가 가드) + `RacePaceBadge`(배지·선두권 N마리·⑲ 실측 해석 1줄) → 출마정보(쿼리 0)·/picks. ② **/picks 주간 전환** — 오늘 → 이번 주(월~일, `weekRange`), 다가오는(날짜 그룹)/지난(실착순 ✅=1~3착) 섹션, 당일 훅 삭제. 부수: 대시보드 "이번주 강추" 라벨-데이터 불일치 해소(당일→주간 훅), 주간 명단 1000행 페이지네이션 방어. 운영: 목요일 cron 서울 API 타임아웃 1회 → workflow_dispatch 재실행 안내(잡명 racecard — pipeline_guide에 명시 d48643e). 상세 → [06-ui](status/06-ui.md)

## 2026-07-15 — 무인 운영 진입 + 페이스 조건부 성적(pace_fit·pace_sens) 기각 (main 머지 5c32ae1)
① **무인 운영 진입** — secrets 등록 후 수요일 15:00 첫 스케줄 cron sync 성공, 사이트 자료 확인(L-002~005 잔여 사용자 작업 완료). ② **페이스 조건부 성적 기각** — F-001 UI 브레인스토밍 중 사용자 가설("환경 변화에 누가 일관/비일관하게 강한가")로 전환. 과거 경주를 실측 초반 페이스로 라벨(avg_s1f vs par ±0.11초=probe 30/70분위)해 pace_fit(통산 대비 델타, n/(n+3) 수축)·pace_sens(버킷 간 격차) 구현 → 게이트A 진단전용(|r|max 0.23, 사용자 결정으로 탈락판정 제거) → **통제 A/B 6분기 평균 Δ+0.57%p < 사전등록 +1.0%p → 기각**(t1/t2 교차도 미달). 낮은 상관인데도 기여 0 = 흡수 계열 재확인. 노출 제거·집계 인프라 유지(재조작화 대비)·pacePar 라이브 로드 방어(L-001 보호). shape_d6_best 코드 revert(기각 즉시 제거 원칙 확립) + 전개 스펙 §7 잔여 후보 TODO 이월(F-004 H7 교차표·F-005 사후 리뷰). F-001 UI는 설계 초안 승인 상태로 재개 가능. 상세 → [04-signals](status/04-signals.md) · [[project_pace_conditional_form_rejected]]

## 2026-07-13~15 — 7/10 경주 분석 → 피처 카탈로그 신설 + shape_d6_best 기각 (브랜치 feat/feature-catalog-d6best)
7/10 부경 6R 실전 분석(예측 1위 퀸메이커 2착=연승 적중·우승마 투혼파이터는 모델 5위/시장 7위 — 선행 3두 과열→페이스 붕괴 경주, 시장도 동반 실패, picks는 올바르게 침묵)에서 파생된 3갈래. ① **docs/feature_catalog.md 신설(SSOT)** — v7 raw 피처 ~90개 측정 기준·산식·주의점(body_weight 회색지대 등) 한 장 정리, "라이브=raw만, 수제 맵=레거시" 구조 명문화. ② **shape_d6_best(종반 600m 역대 최고=한 방 능력) 게이트 실험 → 기각** — 게이트A |r|=0.72(rating·speed와 중복 경고), 게이트B 연승 Δ−0.2%p·1/5분기 → 피크 능력은 능력 지표에 이미 흡수. 코드는 raw 후보 잔류(라이브 무영향). ③ probe:features 감사로 recent_ord 계열 신뢰성 확인 — **recent_ord_last가 109개 중 1위 일꾼(coef −0.159)**, std·hist_n은 죽은 무게(무해). 결론: 피처 정리·재설계 불필요(L2 자기조절), 실질 구멍은 경주 단위 페이스 집계(F-001). 부수 수정: 문서 sync 명령 오기 정정(sync:racecard→sync:cards 등 4파일)·probe:corr archive 복구 재등록·대시보드 날짜 URL 쿼리 유지 fix(전부 main 머지됨). 상세 → [04-signals](status/04-signals.md) · [[project_shape_d6_best_rejected]]

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
