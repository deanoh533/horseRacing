# 프로젝트 전체 정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 불필요한 파일 삭제·아카이브, CLAUDE.md 슬림화, TODO.md 정리로 토큰 비용 절감 및 코드베이스 가독성 향상

**Architecture:** Tasks 1–4는 완전 독립. 공유 파일 없음. **병렬 동시 실행 가능.** 각 태스크가 하나의 커밋을 생성한다.

**Tech Stack:** git (git mv for tracked file moves), bash

---

> ⚠️ **병렬 실행 가능:** Tasks 1, 2, 3, 4는 서로 다른 파일을 건드리므로 동시에 실행해도 충돌 없음.

---

### Task 1: data/ 임시 파일 삭제 + scripts/archive/ 이동

**Files:**
- Delete: `data/smoke.jsonl`, `data/training_matrix.q1.bak.jsonl`, `data/quinella_dividends.q1.bak.jsonl`, `data/training_matrix.classmove.bak.jsonl`, `data/quinella_dividends.gap.jsonl`, `data/quinella_dividends.pre-gap.bak.jsonl`, `data/training_matrix.gap.jsonl`
- Create: `scripts/archive/` (디렉터리)
- Move to `scripts/archive/`: 31개 일회성 스크립트 (아래 목록)

**이동 대상 스크립트 (31개):**
```
analyze_sires.ts
check_date_range.ts
check_dates.ts
check_dup_predictions.ts
check_earnings_correlation.ts
check_history.ts
check_horses_count.ts
check_ord1.ts
check_race_cards.ts
check_rls.ts
check_schema.ts
check_smart_mink.ts
check_st_ord.ts
check_unique_horses.ts
check_weight_history.ts
experiment_logistic.ts
experiment_pl.ts
probe_api214_fields.ts
probe_api4_3.ts
probe_compare_apis.ts
probe_feature_corr.ts
probe_market_edge.ts
probe_odds_vs_finish.ts
probe_popularity_odds.ts
probe_speed_figure.ts
test_future_race.ts
test_predict_from_cards.ts
test_racecard_api.ts
test_racecard_future.ts
test_score_engine.ts
test_with_real_data.ts
```

- [ ] **Step 1: data/ 임시 파일 삭제**

```bash
cd /c/Users/mjy76/Documents/projectFolder
git rm data/smoke.jsonl \
       data/training_matrix.q1.bak.jsonl \
       data/quinella_dividends.q1.bak.jsonl \
       data/training_matrix.classmove.bak.jsonl \
       data/quinella_dividends.gap.jsonl \
       data/quinella_dividends.pre-gap.bak.jsonl \
       data/training_matrix.gap.jsonl
```

Expected: 7개 파일 삭제 staged

- [ ] **Step 2: scripts/archive/ 디렉터리 생성 및 스크립트 이동**

```bash
mkdir -p scripts/archive

# analyze
git mv scripts/analyze_sires.ts scripts/archive/

# check_*
git mv scripts/check_date_range.ts scripts/archive/
git mv scripts/check_dates.ts scripts/archive/
git mv scripts/check_dup_predictions.ts scripts/archive/
git mv scripts/check_earnings_correlation.ts scripts/archive/
git mv scripts/check_history.ts scripts/archive/
git mv scripts/check_horses_count.ts scripts/archive/
git mv scripts/check_ord1.ts scripts/archive/
git mv scripts/check_race_cards.ts scripts/archive/
git mv scripts/check_rls.ts scripts/archive/
git mv scripts/check_schema.ts scripts/archive/
git mv scripts/check_smart_mink.ts scripts/archive/
git mv scripts/check_st_ord.ts scripts/archive/
git mv scripts/check_unique_horses.ts scripts/archive/
git mv scripts/check_weight_history.ts scripts/archive/

# experiment_*
git mv scripts/experiment_logistic.ts scripts/archive/
git mv scripts/experiment_pl.ts scripts/archive/

# probe_*
git mv scripts/probe_api214_fields.ts scripts/archive/
git mv scripts/probe_api4_3.ts scripts/archive/
git mv scripts/probe_compare_apis.ts scripts/archive/
git mv scripts/probe_feature_corr.ts scripts/archive/
git mv scripts/probe_market_edge.ts scripts/archive/
git mv scripts/probe_odds_vs_finish.ts scripts/archive/
git mv scripts/probe_popularity_odds.ts scripts/archive/
git mv scripts/probe_speed_figure.ts scripts/archive/

# test_*
git mv scripts/test_future_race.ts scripts/archive/
git mv scripts/test_predict_from_cards.ts scripts/archive/
git mv scripts/test_racecard_api.ts scripts/archive/
git mv scripts/test_racecard_future.ts scripts/archive/
git mv scripts/test_score_engine.ts scripts/archive/
git mv scripts/test_with_real_data.ts scripts/archive/
```

- [ ] **Step 3: 결과 확인**

```bash
git status --short | head -50
ls scripts/ | grep -v archive
```

Expected: scripts/ 루트에 `backfill_*`, `sync_*`, `apply_*`, `walkforward_*`, `extract_*`, `backtest_*`, `collect_*`, `learn_*`, `promote_*`, `verify_*`, `refresh_*`, `build_*`, `fetch_*`, `accuracy_stats.ts`, `final_stats.ts`, `weight_grid_search.ts`, `lib/` 만 남음

- [ ] **Step 4: 커밋**

```bash
git commit -m "$(cat <<'EOF'
chore: 임시 데이터 파일 삭제 + 일회성 스크립트 archive 이동

data/ .bak·.gap·smoke 7개 삭제
scripts/archive/ 로 check_*·probe_*·test_*·experiment_*·analyze_* 31개 이동

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: docs/superpowers/archive/ 이동

**Files:**
- Create: `docs/superpowers/archive/specs/`, `docs/superpowers/archive/plans/`
- Move: specs 14개, plans 15개 (날짜 2026-06-11 이전)
- Keep: `2026-06-12-duckdb-local-mirror-design.md`, `2026-06-12-duckdb-local-mirror.md`, `2026-06-12-project-cleanup-design.md`, `2026-06-12-project-cleanup.md`

**이동 대상 specs (14개):**
```
2026-05-28-score-redesign-design.md
2026-05-30-loading-skeleton-design.md
2026-05-30-predictionsheet-redesign-design.md
2026-05-30-raceentries-panel-redesign.md
2026-05-31-grade-dist-stats-design.md
2026-06-03-speed-figure-design.md
2026-06-04-score-learning-redesign-design.md
2026-06-04-stage1-logistic-productionization-design.md
2026-06-04-stage2-market-edge-probe-design.md
2026-06-04-stage2-phase1-value-betting-design.md
2026-06-04-stage2-phase2a-quinella-place-betting-design.md
2026-06-05-earnings-asof-class-signal-design.md
2026-06-05-earnings-asof-reconstruction-design.md
2026-06-10-prior-race-delta-signals-design.md
```

**이동 대상 plans (15개):**
```
2026-05-28-score-redesign.md
2026-05-30-loading-skeleton.md
2026-05-30-predictionsheet-redesign.md
2026-05-30-raceentries-panel-redesign.md
2026-05-31-grade-dist-stats.md
2026-06-03-speed-figure.md
2026-06-04-score-learning-redesign-A-foundation.md
2026-06-04-score-learning-redesign-B1-offline-experiment.md
2026-06-04-score-learning-redesign-B2-gbdt-challenger.md
2026-06-04-stage1-logistic-productionization.md
2026-06-04-stage2-market-edge-probe.md
2026-06-04-stage2-phase1-value-betting.md
2026-06-04-stage2-phase2a-quinella-place-betting.md
2026-06-05-earnings-asof-class-signal.md
2026-06-05-earnings-asof-reconstruction.md
```

- [ ] **Step 1: archive 디렉터리 생성**

```bash
cd /c/Users/mjy76/Documents/projectFolder
mkdir -p docs/superpowers/archive/specs
mkdir -p docs/superpowers/archive/plans
```

- [ ] **Step 2: specs 이동**

```bash
SPEC_DIR=docs/superpowers/specs
ARCH_SPEC=docs/superpowers/archive/specs

git mv $SPEC_DIR/2026-05-28-score-redesign-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-05-30-loading-skeleton-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-05-30-predictionsheet-redesign-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-05-30-raceentries-panel-redesign.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-05-31-grade-dist-stats-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-03-speed-figure-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-04-score-learning-redesign-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-04-stage1-logistic-productionization-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-04-stage2-market-edge-probe-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-04-stage2-phase1-value-betting-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-04-stage2-phase2a-quinella-place-betting-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-05-earnings-asof-class-signal-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-05-earnings-asof-reconstruction-design.md $ARCH_SPEC/
git mv $SPEC_DIR/2026-06-10-prior-race-delta-signals-design.md $ARCH_SPEC/
```

- [ ] **Step 3: plans 이동**

```bash
PLAN_DIR=docs/superpowers/plans
ARCH_PLAN=docs/superpowers/archive/plans

git mv $PLAN_DIR/2026-05-28-score-redesign.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-05-30-loading-skeleton.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-05-30-predictionsheet-redesign.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-05-30-raceentries-panel-redesign.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-05-31-grade-dist-stats.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-03-speed-figure.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-04-score-learning-redesign-A-foundation.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-04-score-learning-redesign-B1-offline-experiment.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-04-score-learning-redesign-B2-gbdt-challenger.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-04-stage1-logistic-productionization.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-04-stage2-market-edge-probe.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-04-stage2-phase1-value-betting.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-04-stage2-phase2a-quinella-place-betting.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-05-earnings-asof-class-signal.md $ARCH_PLAN/
git mv $PLAN_DIR/2026-06-05-earnings-asof-reconstruction.md $ARCH_PLAN/
```

- [ ] **Step 4: 결과 확인**

```bash
ls docs/superpowers/specs/
ls docs/superpowers/plans/
```

Expected: 각 폴더에 `2026-06-12-*` 파일 2~3개만 남음

- [ ] **Step 5: 커밋**

```bash
git commit -m "$(cat <<'EOF'
chore(docs): 완료된 specs·plans archive 이동

docs/superpowers/archive/specs/ — 14개
docs/superpowers/archive/plans/ — 15개
2026-06-12 진행 중인 DuckDB·cleanup 문서만 루트 유지

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: CLAUDE.md 슬림화 + docs/session_history.md 생성

**Files:**
- Modify: `CLAUDE.md` (lines 158, 165–224 교체)
- Create: `docs/session_history.md`

> 이 작업 전에 반드시 `Read("CLAUDE.md")` 로 전체 파일을 읽고 Edit 도구로 정확히 수정할 것.

- [ ] **Step 1: CLAUDE.md 읽기**

`CLAUDE.md` 전체를 Read 도구로 읽는다.

- [ ] **Step 2: "세션 인계" 섹션 링크 수정**

"세션 인계" 섹션에서 아카이브된 스펙 링크를 교체한다.

교체 전:
```
- [docs/superpowers/specs/2026-05-28-score-redesign-design.md](docs/superpowers/specs/2026-05-28-score-redesign-design.md) — **점수 알고리즘 재설계 스펙** (3단계 전체 완료)
```

교체 후:
```
- [docs/session_history.md](docs/session_history.md) — 세션별 작업 히스토리 (2026-06-02 ~ 현재)
```

- [ ] **Step 3: "핵심 이슈" 섹션 교체**

아래 블록 전체를 찾아 교체한다.

교체 전 (시작 ~ 끝):
```
## ⚠️ 지금 알아야 할 핵심 이슈

> **2026-06-12 — DuckDB 로컬 미러 설계 완료 (브랜치 feat/duckdb-local-mirror)**
```
(이 섹션의 끝은 빈 줄 다음에 오는 `항목별 상태(완료/진행/ρ 값/개선 후보)는 아래 문서가` 줄 직전까지)

교체 후 (전체 내용):
```markdown
## ⚠️ 현재 실행 상태 (2026-06-12)

**브랜치:** `feat/duckdb-local-mirror` (main 미머지)  
**Supabase 제한:** 2026-06-23 리셋 (egress 소진 — 읽기·쓰기·웹앱 전부 차단)  
**활성 모델:** id=5 (logit-20260611) — 연승 60.1% / 단승 28.9% / 시장 −8.1%p  
**DuckDB 스펙:** `docs/superpowers/specs/2026-06-12-duckdb-local-mirror-design.md`

**다음 단계 (우선순위):**
1. **db:pull 실행** (6/23 이후) — `npm run db:pull` → byte-identical 검증 → 나머지 스크립트 전파
2. **마체중 직전수집** — KRA 직전정보/계량 API 조사 (gate B +7.2%p, 가장 유망)
3. **시장격차(−8%p) 좁힐 새 raw 신호** — 다분기 gate B (`backtest:box:quarters`) 기준
4. **복승 배당 결손** — 2026-05-10~06-05 미수집 (6/23 이후 친구 키로 보충)

**롤백:** 이전 model_version id로 promote

> 세션별 상세 히스토리 → [docs/session_history.md](docs/session_history.md)

```

- [ ] **Step 4: docs/session_history.md 생성**

아래 내용으로 `docs/session_history.md` 를 Write 도구로 생성한다.

```markdown
# 세션 작업 히스토리

> CLAUDE.md 핵심 이슈 섹션에서 분리. 과거 세션의 상세 컨텍스트 보존용.

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
```

- [ ] **Step 5: 변경 확인**

```bash
wc -l CLAUDE.md
```

Expected: 기존 253줄에서 ~210줄 이하로 감소

- [ ] **Step 6: 커밋**

```bash
git add CLAUDE.md docs/session_history.md
git commit -m "$(cat <<'EOF'
docs(claude): 핵심 이슈 슬림화 + 세션 히스토리 분리

CLAUDE.md 핵심 이슈 섹션: 5개 세션 블록 → 15줄 현황 요약
세션별 상세 히스토리 → docs/session_history.md

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: TODO.md 완료 항목 정리

**Files:**
- Modify: `TODO.md`

> 이 작업 전에 반드시 `Read("TODO.md")` 로 전체 파일을 읽고 Edit 도구로 수정할 것.

- [ ] **Step 1: TODO.md 읽기**

`TODO.md` 전체를 Read 도구로 읽는다.

- [ ] **Step 2: 파일 전체를 아래 내용으로 교체**

Write 도구로 TODO.md를 아래 내용으로 완전히 교체한다. (`[x]` 완료 항목과 변경 이력 테이블 전부 제거, 미완료 항목만 유지)

```markdown
# 📋 TODO — 우선순위별 할일

> 마지막 정리: 2026-06-12. 의문·검토 단계는 troubleshooting.md에 남기고, 결정 후 여기로 옮깁니다.

---

## 🟡 P1 — UX / 데이터 보강

### UI/UX 개선

- [ ] **E-004 트랙 이동 이력** — 서울↔부경 이동 말 마킹 (적응 기간 고려)
- [ ] **E-005 연속 완주 여부** — 최근 N경주 모두 완주 여부 (낙마·심정지 이력 경계)

### 신규 기능

- [ ] **F-001 페이스 예측** — 선행마 마릿수 집계 (running_style 데이터 활용 → 접전 여부 예측)
- [ ] **F-003 사용자 메모/별표** — 경주·말별 개인 메모 및 즐겨찾기 기능

- [ ] **PRD v6.1 Phase 2** — HorseDetail 18항목 점수 → 원시값+맥락 표현
- [ ] **T-011 PRD legend derived 5개**
  - ⑨ 마주의 금일 출주두수
  - ⑩ 출전경주와 마필
  - ⑬ 최근 3개월 성적
  - ⑮ 출주간격
  - ⑯⑰ 조교사 통계
  - 방식: SQL view 신설 또는 client-side aggregation
- [ ] **T-012 ㉚ 절대능력지수 — KRA 등급변동 API (#15058076) 조사**
  - probe 스크립트 작성 → 가용성·스키마 확인
- [ ] **T-005 ⑧⑭ 전문가 자문 후 산식 교체**
  - ⑧ 부담중량: ρ=0.321로 이미 강함. 핸디캡=능력proxy 메커니즘 이해 후 개선
  - ⑭ 혈통: 현재 데이터 없음(null). 활성화 전 데이터 확보 필요

## 🟢 P2 — 정리·기술 부채

- [ ] **T-009 적중률 분리 (출전마수·경마장·등급별)**
- [ ] **T-013 외부 데이터 출처 검토** (조교상태·마필가격·복기평·경주로 빠르기)

## 🚀 운영 직전 필수 — 런치 게이팅 항목

> 이 섹션이 전부 완료돼야 실사용(베팅 참고) 전환 가능.

- [ ] **L-001 prediction_logs 테이블 분리**
  - 현재 `predictions` = 가중치 재학습 시 전체 덮어씌워지는 백테스트 DB
  - 운영 전환 후에는 경주 전 예측 스냅샷을 불변 로그로 별도 보존해야 함
  - 설계: `prediction_logs(race_date, meet, rc_no, hr_name, predicted_rank, total_score, weights_version, created_at)` — INSERT only, UPDATE/DELETE 금지

- [ ] **L-002 sync 자동화 스케줄링**
  - 현재: 수동 `tsx scripts/...` 실행
  - 필요: 출마표(수 14:30) → `sync:racecard` 자동 실행, 경기 결과(금·토·일 밤) → `sync:daily` 자동 실행
  - 방법 미정 (cron / GitHub Actions / Vercel Cron 중 선택 필요)

- [ ] **L-003 가중치 재학습 주기 정책 결정**
  - 현재: 수동으로 `apply_learned_weights.ts --alpha=1.0` 실행
  - 결정 필요: 언제 재학습? (매월? 데이터 N경주 누적 시? 적중률 X% 이하 시?)
  - 자동 재학습 시 predictions 전체 재계산이 수반됨 → L-001(logs 분리) 선행 필수

- [ ] **L-004 에러 알림 채널**
  - 현재: 콘솔 로그만 (아무도 안 보면 sync 실패 인지 불가)
  - 필요: sync 실패·API 오류 시 이메일 or 슬랙 or 카카오 알림
  - 최소 구현: sync 스크립트 exit code != 0 → 알림 발송

- [ ] **L-005 DB 백업·복구 계획**
  - 위험: `apply_learned_weights.ts` 버그 or 잘못된 alpha로 predictions 38K 행 오염
  - 필요: Supabase 자동 백업 주기 확인 + 수동 복원 절차 문서화
  - 최소 구현: 재학습 전 `predictions` 스냅샷 테이블 생성 스크립트

---

## 🔮 P3 — 향후 확장 (백로그)

- [ ] **AI 인사이트** — 각 경주에 Claude API 코멘트 (PRD Phase 2)
- [ ] **PDF 분석 보고서** — 경주별 자동 생성
- [ ] **유튜브 대본 자동 생성** — 경주별
- [ ] **win_odds 시계열 캡처** — 경주 직전 변동 추적

---

## 의문 (해결 필요)

- [ ] **Q-001** ⑤ "후반 구간"의 시작점 정의 (g3f vs g1f vs 둘 다)
- [ ] **Q-002** Spearman 학습 윈도우 (전 기간 vs 최근 1년 vs 슬라이딩)
- [ ] **Q-003** 가중치 학습 적용 빈도 (수동 vs 주기적 vs 임계점)
```

- [ ] **Step 3: 결과 확인**

```bash
grep -c '\[x\]' TODO.md
grep -c '\[ \]' TODO.md
```

Expected: `[x]` 0개, `[ ]` 23개 이상

- [ ] **Step 4: 커밋**

```bash
git add TODO.md
git commit -m "$(cat <<'EOF'
docs(todo): 완료 항목 정리 — [x] 전부 제거, 미완료만 유지

변경 이력 테이블 제거 (git log 대체)
미완료 항목 P1·P2·런치게이팅·P3·Q 유지

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
