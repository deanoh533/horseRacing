# 세션 작업 히스토리

> CLAUDE.md 핵심 이슈 섹션에서 분리. 과거 세션의 상세 컨텍스트 보존용.

---

## 2026-06-25 — 선별 표시·베팅 (적중률 향상 트랙 C) 구현·배포

**방향 결정:** "다음 뭐 할까" → 적중률 향상 방향 재질문(버튼) → **C. 선별 표시·베팅** 채택.
공개피처 시장격파([[project_market_dominance_ceiling]])는 종결 상태, 위에서 택한 위험0 서비스 트랙.
이미 라이브에 있는 Platt 연승확률 `p_top3`로 확신 높은 마만 골라 라벨링.

**워크플로우:** brainstorm → spec → plan → subagent-driven(Task1~8, 모델 sonnet) + 매 Task 2단계 리뷰 + 최종 전체 리뷰(opus, READY TO MERGE).

**결정사항(브레인스토밍):** 마 단위 · 연승 p_top3 중심(단승은 부수) · 목표 적중률 고정 · 강추/주목 2티어 · 뱃지+/picks 뷰+상시추적 · config 단일출처(접근법 A, 읽기 레이어만).

**임계값 데이터 확정(균형안):** `npm run probe:picks` 곡선 → **강추 p_top3≥0.72 · 주목 [0.62, 0.72)**.
- track 실측(사후 38,518행, 베이스라인 연승 28.4%): 강추 357건 73.1%·커버 8.9% / 주목 1,207건 65.4%·커버 26.8% (**+44.7 / +37.0%p**).
- 0.85↑(≤10건)는 과소적합 위험 비채택, 표본 큰 평탄구간 채택. in-sample 한계 명시.

**산출물(11커밋, main 머지·push 완료):**
- 순수 SSOT `src/engine/eval/selectivePicks.ts`(classifyTier·buildSelectionCurve·tierAccuracy·pickThreshold) + 테스트.
- `scripts/probe_selective_picks.ts`(`probe:picks` — 곡선/`--strong --watch --write`/`--track`/`--from`, 로컬 DuckDB egress 0).
- config 단일출처 `client/src/config/selective_picks.json`.
- 클라이언트: `lib/selectivePicks.ts`·`components/PickBadge.tsx`·`pages/TodayPicks.tsx`(`/picks`)·통계 `useSelectivePickAccuracy` 섹션.
- 검증: 루트 tsc·417 테스트(1 skip)·client:build 클린.

**남음:** ① 라이브 시각 확인(/picks·뱃지·통계 — Vercel 배포 후). ② 비차단 후속 3건(probe Math.min→reduce·TodayPicks isError/빈상태문구·음수 리프트 부호). ③ 병행 권고였던 **B. 조건부 엣지 마이닝** 재탐색 미착수.

상세 [[project_selective_picks]] · 배경 [[project_market_edge_strategy]].

---

## 2026-06-14 — 롤링 벤치마크 통합 스펙 (benchmark ← walkforward)

**목표:** "benchmark가 생겼는데 walkforward가 필요한가?" 질문에서 출발, 두 검증도구 관계 정리 + 통합 설계.

**분석 결론:**
- benchmark vs walkforward 차이: benchmark=아키텍처 탐색(고정분할, DuckDB), walkforward=ρ 버전 대결(롤링, Supabase).
- **정정:** benchmark는 이미 시장 비교 행이 있음(`METHOD_KEYS`에 `market`). 없는 건 walkforward의 *깊은* 진단(불일치·순위별·상위3 묶음)·롤링·챔피언 대결.
- **구조적 어긋남:** 라이브가 이미 Logistic(id=5/6)인데 walkforward는 ρ 후보만 비교 → 비교 축 불일치. 승격 사이클이 끊김.
- → **통합이 필수** (선택 아님). benchmark를 롤링으로 바꾸고 walkforward 흡수·삭제.

**산출물:**
- 스펙: `docs/superpowers/specs/2026-06-14-rolling-benchmark-integration-design.md`
- 4 변경: ①고정분할→롤링 확장윈도우 ②깊은 시장진단 이식 ③챔피언 대결(model_versions) ④Supabase 의존 제거
- 코드 분리안: `src/engine/eval/{collect,gateA,gateB,models,rolling,market,champion,report}.ts` + 얇은 `scripts/benchmark_all.ts`

**확정 결정 (미결 2개 해소):**
- **9개 모델 전부 롤링** (한 루프 단순·모델별 안정성 확보. >5분이면 핵심3개 하이브리드 후퇴).
- **model_versions 스키마 준비만 지금**(`model_type`/`feature_schema`/`params`), 적용·params 채우기는 6/23 후. id=5 params 비면 ρ 챔피언만 비교(점진 이행).
- Gate A/B는 롤링과 분리, 1회만 유지.

**착수 조건:** 6/23 egress 리셋 후 `db:pull → benchmark`로 Logistic 실측 우위 확인 다음. 구현 0.

**문서 갱신:** accuracy_metrics·pipeline_guide·data_flow에 "통합 예정/삭제 예정" 표시 + 스펙 링크 추가.

**미해소 메모:** 활성 모델 id 불일치 — 메모리=id=6(v6-class-move) vs CLAUDE.md=id=5. 6/23 착수 전 확인 필요.

---

## 2026-06-12 — 파이프라인 문서화 세션

**목표:** API 수집→가공→학습→예측 전체 흐름 문서 정리 + 새 검증/학습방법 추가 시 문서 갱신 규칙 확립.

**작업 내용:**
1. `docs/data_flow.md` 전면 재작성 — DuckDB·Gate A/B·Benchmark 포함한 7단계 파이프라인
2. `docs/accuracy_metrics.md` 확장 — Gate A/B + 멀티모델 3레이어 다이어그램 + §9 변경 이력 + 문서 갱신 규칙 상단 명시
3. `docs/pipeline_guide.md` 신규 — 4개 데이터 소스 역할·라이브 예측 흐름·핵심 스크립트·전체 명령어·신호 발굴 표준 절차
4. CLAUDE.md 문서 인덱스 갱신

**핵심 정리 내용:**

| 구분 | 요점 |
|---|---|
| KRA API | 수집 전용. 결과는 Supabase로만 감 |
| Supabase | 쓰기(sync/backfill/promote/apply_weights) + 웹 읽기 + walkforward 읽기 |
| DuckDB | 오프라인 분석 전용 (benchmark/backtest/probe 전부) |
| 매트릭스 | extract:matrix로 DuckDB→JSONL. backtest_box/probe_corr/learn_logistic이 읽음 |
| benchmark | DuckDB 직접. rawScores+features 둘 다 필요. predictions 안 읽음 |
| walkforward | Supabase predictions 읽음. Spearman 전용. DB에 저장된 rawScore 재활용 |

**문서 갱신 규칙 확립:**
- 새 검증/학습 방법 추가 시 `pipeline_guide.md` §9 + `accuracy_metrics.md` §9 + `score_roadmap.md` 마스터 상태표 함께 갱신

**커밋:** d76948b (문서 통합), a7202cc (pipeline_guide 신규)

---

## 2026-06-12 — Multi-Model Benchmark 구현 (feat/duckdb-local-mirror)

**목표:** `npm run benchmark` 한 명령으로 Spearman·Logistic·GBDT·PL·시장 배당 전 방법 비교.

**설계 결정 (이전 세션에서 확정):**
- TRAIN 2024~2025 / TEST 2026 고정 split (walkforward 아님)
- Gate A: 피처 간 Pearson |r|>0.5 경고만, 자동탈락 없음 (상관 ≠ 중복 정보)
- Gate B: holdout=2025-Q4, 연승률 개선량 > 0이면 포함 (ROI 아님 — 높은 적중률=낮은 ROI 역설 회피)
- Supabase 0 호출 — DuckDB 직접
- 피처 공간 분리: Spearman=rawScore 21개 / Logistic·GBDT·PL=buildFeatures 60개

**구현 완료 (8 커밋):**
1. `gatherRaceInputs` / `predictRace` → `ReadClient` 추상화 (scorePredictor.ts + 관련 6파일)
   - 내부 callees(modelVersion·speedFigure·asOfHorseStats)도 함께 교체
2. `scripts/benchmark_all.ts` 신규 (560줄):
   - `collectRaces(db, from, to)` — DuckDB에서 races 목록 → 경주별 gatherRaceInputs → rawScores + buildFeatures
   - `runGateA` / `printGateA` — Pearson 상관 경고
   - `runGateB` / `printGateB` — 항목별 logistic with/without 비교, 연승률 개선량
   - `learnSpearman` / `spearmanRho` — computeOptimalWeights 인라인 재구현 (weightLearner SupabaseClient 의존 우회)
   - `trainAllModels` — 9개 모델 동시 학습
   - `evaluateRace` / `evaluate` / `printReport` — 단/연/복승 분기별+전체 ASCII 표
   - `main()` 오케스트레이터
3. `package.json` — `"benchmark": "tsx scripts/benchmark_all.ts"` 등록
4. 코드 리뷰 수정: Gate B `__missing` 불일치 수정, 데드코드 제거

**알려진 설계 트레이드오프:**
- Gate B holdout(Q4 2025)이 trainAllModels에 폴드백됨 (스펙 의도적 — 2026 테스트는 클린)
- `weightLearner.ts`는 SupabaseClient 유지 (write 필요, 이번 범위 밖)

**다음:** db:pull(6/23 이후) → `npm run benchmark` 실행 → 결과 보고 새 신호 탐색

---

## 2026-06-11 — class_move promote + 패리티 버그 수정 + PL 모델 (main 커밋)

이 세션 흐름(시간순):
1. **신규 후보 3개 게이트** (직전대비 변화): **게이트A** — `away_meet` 탈락(전체 100% 상수=원정 0건, 다신 제안 X), dist_change·track_change 통과. **게이트B 단일분기**(2025 Q1) 둘 다 +로 통과처럼 보임.
2. **PL(Plackett-Luce) 모델 신규** — `src/engine/models/plackettLuce.ts`(TDD). PL은 단·연·복·쌍승 **전부** 로지스틱에 짐 → **로지스틱 확정, PL 폐기.**
3. **★ 다분기가 게이트B 표준** — `backtest:box:quarters`로 dist_change·track_change **둘 다 탈락**(2/5 분기, 노이즈). **class_move는 강건**(4/5, +3.9%p) → 채택.
4. **★ 패리티 버그 발견·수정** — `scorePredictor` 기수·조교사 90일 쿼리가 Supabase 1000행 캡에 걸려 비결정 잘림 → 페이지네이션+안정정렬.
5. **gatherRaceInputs 배치화** — 경주당 ~150→~7 라운드트립, 187경주 224s→61s(3.7×).
6. **promote id=5** (logit-20260611) 활성. 연승 60.1%/단승 28.9% vs 시장 68.2/37.2 = **−8.1%p**.
7. **복승 배당 결손** — 우리 키 2025-11-30까지만. 친구 키로 2025-12~2026-05-09 수집. 마지막 4주(05-10~06-05) 여전히 결손.

**다음:** ①마체중 직전수집 ②시장격차 신호 탐색 ③복승 배당 마지막 4주 보충

---

## 2026-06-10 — 복승 박스 타깃 + 2단계 게이트로 신호 발굴

- **목표:** 복승 3마리 박스 ROI. **라벨 top2 채택**(top3 대비 +8%p).
- **2단계 게이트(표준):** A=`probe:corr`(후보↔기존 |r|>0.5 중복제외) → B=`backtest:box --label top2`(holdout 복승박스 ROI).
- **채택:** **등급이동 `class_move`** — 게이트B 단독 **+2.2%p**(−25.0→−22.8), prize_cond 100% 사전가용 → **라이브 클린**.
- **탈락:** z-score·구간후보6·경쟁강도3·장구·기수변경·class_dropped.
- **보류:** 마체중 gate B +7.2%p 통과했으나 `wg_hr`이 경기후 결과에만 채워짐=라이브 누수.
- **신규 도구(main):** `extract:matrix`·`probe:corr`·`backtest:box`·`refresh:logistic`.

---

## 2026-06-06 — 재설계 최종값 확정 + earnings 트랙 종결

- **최종 walkforward:** 로지스틱 **연승 59.0%** / v1 57.6% / 시장 68.8%. 모델−시장 = **-9.8%p**.
- **★ 음성지식 확정:** 수득상금 차원 자체가 예측력 없음. 재설계 "+5.2%p"는 전부 earnings 미래누수였음.
- **DB:** 마이그012·013 적용, erng_sump_asof 38,627행 채움. 학습행렬 37,992행 재추출.
- **결정:** A) B3 승격(로지스틱) / B) 복연승 백테스트 / C) 새 신호 탐색 — 다음 세션으로 위임.

---

## 2026-06-03 — ⑳ 속도능력지수 신규 + 시장 벤치마크

- **시장 벤치마크 발견:** 모델이 인기1위에 연승 11%p 뒤짐. 엇갈릴 때 22%p 더 틀림(부가가치 음).
- **⑳ 속도능력지수** 추가 → ρ=0.271(정직 4위). 후보 v3: 연승 +3.6%p, 시장 격차 -11.1→-7.5%p.
- **append-only** 방식(v1 weight 0이라 backfill이 기존 점수 불변).
- 결국 v3 미승격, 로지스틱 재설계로 방향 전환.

---

## 2026-06-02 — 가중치 버전관리 도입 + 치팅 누수 수정

- **look-ahead 누수 수정** (`src/engine/asOfHorseStats.ts`). **옛 적중률(단32.5/연52.8/복65.9)은 거짓** — 정직값 복승 ~58%.
- **model_versions** 테이블로 가중치 버전 관리. predictions에 `model_version` 도장.
- v1=기준선(활성), v2=2024학습 후보.
- 도구: `npm run walkforward`·`learn:candidate`·`promote`·`build:rho-history`.
