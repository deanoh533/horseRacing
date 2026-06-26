# 문서 구조 재편 + npm/파일 감사 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 진행상황이 4곳에 중복된 문제를 `docs/status/` 6개 트랙 파일 SSOT로 재편하고, 깨진 npm 6개·임시 스크립트를 감사한다.

**Architecture:** 신규 `docs/status/01~06.md`가 트랙별 "현재상태+다음+종결요약"의 SSOT. CLAUDE.md는 트랙 인덱스(링크만), session_history는 타임라인, 메모리는 회상 인덱스, TODO는 할일 백로그로 역할 분리. 트랙 파일은 포인터만 — 상세 수치는 기존 문서가 SSOT(드리프트 방지).

**Tech Stack:** Markdown. `package.json` npm scripts. git. 검증은 파일존재·grep 링크체크·`npm run build`.

## Global Constraints

- 트랙 파일 경로: `docs/status/NN-<name>.md` (01-scoring, 02-model-benchmark, 03-market-edge, 04-signals, 05-data-infra, 06-ui)
- 트랙 파일 템플릿 고정: `# 제목` + `> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[..]]` + `## 현재 상태` / `## 다음 후보·남음` / `## 종결·기각(요약)` / `## 참고`
- 트랙 파일에 **상세 산식·실측 수치 재기재 금지** — 한 줄 결론 + 근거 문서 링크만
- 메모리 링크는 `[[slug]]` 형식 (MEMORY.md의 슬러그와 정확히 일치)
- 커밋 메시지 한국어 + scope. 끝에 Co-Authored-By/Claude-Session 푸터
- 브랜치 `chore/docs-restructure` (이미 생성됨, 스펙 커밋 `b273825` 존재)
- 코드 변경 없음 → 빌드 검증은 Task 8(npm) 에서만

---

### Task 1: 트랙 파일 01 — 점수·알고리즘

**Files:**
- Create: `docs/status/01-scoring.md`

**출처 (읽을 것):** CLAUDE.md(점수 관련) · session_history.md `2026-06-02`·`2026-06-06` 블록 · 메모리 `project_score_roadmap`·`project_running_style_classification`·`project_running_style_pace_map`·`project_weight_versioning`·`reference_running_style_insight_doc` · TODO.md `T-005`·`T-011`·`T-012`·`Q-001~003`

- [ ] **Step 1: 파일 작성** — 아래 내용으로:

```markdown
# 점수·알고리즘 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_score_roadmap]], [[project_running_style_classification]], [[project_running_style_pace_map]], [[project_weight_versioning]], [[reference_running_style_insight_doc]]

## 현재 상태
21개 항목 raw(0~1) → 라이브 로지스틱이 buildFeatures one-hot으로 직접 학습(Spearman 가중치는 레거시). 활성 산식 안정. 항목별 ρ·가중치·개선상태 SSOT = [docs/score_roadmap.md](../score_roadmap.md) §1 마스터 상태표.

## 다음 후보·남음
- 🔲 최우선: ⑧ 부담중량 산식 개선 (ρ=0.316, 전문가 자문 대기) → TODO T-005
- 🔲 ⑭ 혈통 활성화 — 데이터 확보 후 → TODO T-005
- 🔲 ㉚ 절대능력지수 — KRA 등급변동 API(#15058076) 조사 → TODO T-012
- 🔲 PRD legend derived 5개 → TODO T-011
- 🔲 의문: ⑤ 후반구간 시작점·Spearman 윈도우·학습 빈도 → TODO Q-001~003

## 종결·기각 (요약)
- ✅ 가중치 버전관리 + look-ahead 누수 수정 (2026-06-02) — 옛 적중률 거짓, 정직값 복승 ~58%. `asOfHorseStats.ts`. [[project_weight_versioning]]
- ❌ 수득상금(earnings) 차원 — 예측력 0, 재설계 "+5.2%p"는 전부 미래누수였음 (2026-06-06). [[reference_earnings_asof_leak]]
- 🔚 ⑲ 스코어맵 종결 (2026-06-16) — SCORE_MAP=죽은코드, 로지스틱이 one-hot 직접학습. 재설계 불필요. [[project_running_style_pace_map]]

## 참고
- 문서: [score_roadmap.md](../score_roadmap.md), [score_algorithm.md](../score_algorithm.md), [running_style_insight.md](../running_style_insight.md)
- 할일: [TODO.md](../../TODO.md) (T-005·T-011·T-012·Q-001~003)
```

- [ ] **Step 2: 메모리 슬러그 검증** — Run: `grep -oE '\[\[[a-z_]+\]\]' docs/status/01-scoring.md` → 각 슬러그가 MEMORY.md에 존재하는지 확인. Expected: 5개 슬러그 모두 MEMORY.md에 매칭.
- [ ] **Step 3: 상대링크 검증** — `docs/score_roadmap.md`·`docs/score_algorithm.md`·`docs/running_style_insight.md`·`TODO.md` 존재 확인. Expected: 전부 존재.

(커밋은 Task 6 이후 일괄: 모든 트랙 파일 생성 후 한 커밋)

---

### Task 2: 트랙 파일 02 — 예측모델·벤치마크

**Files:**
- Create: `docs/status/02-model-benchmark.md`

**출처:** CLAUDE.md(활성모델·벤치마크) · session_history `2026-06-03`·`2026-06-11`·`2026-06-12`×2·`2026-06-14` · 메모리 `project_market_benchmark`·`project_speed_figure`·`project_rolling_benchmark_integration`·`project_score_learning_redesign`

- [ ] **Step 1: 파일 작성**

```markdown
# 예측모델·벤치마크 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_rolling_benchmark_integration]], [[project_market_benchmark]], [[project_speed_figure]], [[project_score_learning_redesign]]

## 현재 상태
활성 모델 **id=6 (v6-class-move, logistic)**. 벤치 연승 62.5% / 단승 30.6% / 시장 68.2%(−5.7%p). `npm run benchmark` = 롤링 확장윈도우 9모델 + 챔피언(model_versions) 대결 + 시장 깊은 진단 통합(walkforward 흡수·삭제, 2026-06-14). 코드 `src/engine/eval/`. 롤백 = 이전 model_version id로 promote.

## 다음 후보·남음
- 🔲 model_versions 스키마 영구화 — `feature_schema`/`params` Supabase 반영 + 챔피언 artifact 저장 (egress 리셋 후)

## 종결·기각 (요약)
- 🔚 walkforward_eval.ts 삭제 (2026-06-14) — benchmark가 롤링·챔피언·시장진단 흡수. [[project_rolling_benchmark_integration]]
- ❌ PL(Plackett-Luce) 모델 폐기 (2026-06-11) — 단·연·복·쌍승 전부 로지스틱이 흡수.
- ❌ ⑳ 속도능력지수 v3 미승격 (2026-06-03) — ρ=0.271, 시장격차 좁혔으나 로지스틱 재설계로 방향전환. [[project_speed_figure]]
- ★ 시장 벤치마크 음성지식 — 모델이 인기1위에 연승 뒤지고 엇갈릴 때 더 틀림. [[project_market_benchmark]]

## 참고
- 스펙: [multi-model-benchmark](../superpowers/specs/2026-06-12-multi-model-benchmark-design.md), [rolling-benchmark-integration](../superpowers/specs/2026-06-14-rolling-benchmark-integration-design.md)
- 문서: [accuracy_metrics.md](../accuracy_metrics.md)
```

- [ ] **Step 2: 슬러그·링크 검증** — Task 1 Step 2~3과 동일 방식. Expected: 4 슬러그 + 스펙 2개 + accuracy_metrics.md 존재.

---

### Task 3: 트랙 파일 03 — 시장엣지·전략

**Files:**
- Create: `docs/status/03-market-edge.md`

**출처:** CLAUDE.md(Platt·선별·Benter) · session_history `2026-06-25` · 메모리 `project_market_edge_strategy`·`project_market_dominance_ceiling`·`project_benter_blend`·`project_selective_picks` · 스펙 platt-live-calibration·selective-picks

- [ ] **Step 1: 파일 작성**

```markdown
# 시장엣지·전략 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_market_edge_strategy]], [[project_selective_picks]], [[project_market_dominance_ceiling]], [[project_benter_blend]]

## 현재 상태
공개피처로 승/연승 시장격파 = **종결(천장)**. 두 양성 배포 완료:
- **Platt 라이브 캘리브레이션** — predictions에 `p_win`/`p_top3`(우승·연승 보정확률), UI "우승%·연승%" 표시. 랭킹 파이프라인 불변.
- **선별 표시 (트랙 C)** — `p_top3`로 강추 ≥0.72 / 주목 ≥0.62 라벨 → 뱃지 + `/picks` 뷰 + 통계 "선별 적중률". 실측 강추 연승 73.1%·주목 65.4%(베이스 28.4%). 임계값 단일출처 `client/src/config/selective_picks.json`, 재산출 `npm run probe:picks`.

## 다음 후보·남음
- 🔲 선별 표시 **시각 확인** (`/picks`·뱃지·통계 섹션 — Vercel/로컬)
- 🔲 **B. 조건부 엣지 마이닝** 재탐색 (미착수)
- 🔲 선별 트랙 고도화 — 선별 베팅 ROI·엑조틱

## 종결·기각 (요약)
- ❌ Benter 2단계 음성 종결 (2026-06-17/18) — 방향은 실재하나 크기 0("실재하나 무가치한 엣지"). [[project_market_edge_strategy]]
- ❌ Benter 혼합(복승) 기각 (2026-06-11) — 혼합 ROI −28%. [[project_benter_blend]]
- 🔚 공개피처+win_odds 부가가치 0 (천장, 6분기 강건). [[project_market_dominance_ceiling]]
- ⚠️ KRA 엑조틱 공제율 26% > 단복승 20% → 엑조틱이 더 어려움.

## 참고
- 스펙: [platt-live-calibration](../superpowers/specs/2026-06-19-platt-live-calibration-design.md), [selective-picks](../superpowers/specs/2026-06-25-selective-picks-design.md)
- 전략: [strategy/2026-06-16](../strategy/2026-06-16-market-edge-and-korean-winning-conditions.md), [strategy/2026-06-17](../strategy/2026-06-17-ceiling-attempts-theoretical-review.md)
```

- [ ] **Step 2: 슬러그·링크 검증** — 4 슬러그 + 스펙 2 + 전략 2 존재 확인.

---

### Task 4: 트랙 파일 04 — 신호발굴

**Files:**
- Create: `docs/status/04-signals.md`

**출처:** session_history `2026-06-10`·`2026-06-11` · 메모리 `project_feature_gate_findings`·`project_training_signals`·`project_medical_signals`·`project_gate_multimetric`·`feedback_no_human_compression` · `docs/feature_hypotheses.md`

- [ ] **Step 1: 파일 작성**

```markdown
# 신호발굴 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_feature_gate_findings]], [[project_training_signals]], [[project_gate_multimetric]], [[project_medical_signals]], [[feedback_no_human_compression]]

## 현재 상태
2단계 게이트 방법론: A=`probe:corr`(후보↔기존 |r|>0.5 중복제외) → B=`backtest:box`(holdout 복승박스 ROI, 다분기 표준). 게이트B는 holdout 3지표(연승·fade·복승) 동시 측정.
- **채택: 등급이동 `class_move`** — 다분기 +3.9%p(4/5분기 강건), prize_cond 사전가용 → 라이브 클린.

## 다음 후보·남음
- 🔲 조교 *다른* 조작화 (강도·간격 등 recent_form이 못 담는 각도) — 단 흡수 입증 후라 기대↓
- 🔲 마체중 직전수집 (D1) — `wg_hr` 경기후수집=라이브누수 회피할 사전수집 경로 필요

## 종결·기각 (요약)
- ❌ 조교 train_signal 흡수 확정 (2026-06-19) — 게이트B +1.8%p였으나 통제 A/B(같은 스펙 ON/OFF) Δ−0.12% = 흡수. ⚠️ **승격 판정은 통제 A/B로**(게이트B 한계기여 과대보고 의심). [[project_training_signals]]
- ❌ 의료 신호 기각 (2026-06-15) — 출혈·피로치료 게이트B 한계기여 ~0. [[project_medical_signals]]
- ❌ z-score·구간6·경쟁강도3·장구·기수변경·class_dropped 탈락 (2026-06-10).
- ⏸ 마체중 게이트B +7.2%p 보류 — `wg_hr` 라이브 누수.

## 참고
- 문서: [feature_hypotheses.md](../feature_hypotheses.md) (가설 카탈로그)
```

- [ ] **Step 2: 슬러그·링크 검증** — 5 슬러그 + feature_hypotheses.md 존재.

---

### Task 5: 트랙 파일 05 — 데이터인프라

**Files:**
- Create: `docs/status/05-data-infra.md`

**출처:** CLAUDE.md(브랜치·egress·DuckDB·DB현황) · session_history `2026-06-12`(파이프라인) · 메모리 `project_duckdb_local_mirror`·`feedback_local_first_over_db`·`reference_pipeline_guide`·`reference_kra_dividend_api`·`reference_earnings_asof_leak`·`reference_db_schema_gotchas`·`reference_api_spec_doc` · TODO `L-001~005`·`T-013`

- [ ] **Step 1: 파일 작성**

```markdown
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
```

- [ ] **Step 2: 슬러그·링크 검증** — 7 슬러그 + 문서 4 + 02 상호링크 존재.

---

### Task 6: 트랙 파일 06 — UI·화면

**Files:**
- Create: `docs/status/06-ui.md`

**출처:** CLAUDE.md(UI 현황 블록 142~148줄·training_logs 함정) · 메모리 `reference_unused_race_entry_fields`·`reference_training_rider_legend`·`project_busan_sectional_rank_gap`·`reference_betting_terms` · TODO `E-004`·`E-005`·`F-001`·`F-003`·`T-011`·PRD Phase2

- [ ] **Step 1: 파일 작성**

```markdown
# UI·화면 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[reference_unused_race_entry_fields]], [[reference_training_rider_legend]], [[reference_betting_terms]], [[project_busan_sectional_rank_gap]]

## 현재 상태
- 예상지: 모바일 2+2 그리드 / 데스크탑 4열. **HorseCard 컬럼 순서: Col1=마정보(2fr)·Col2=기수정보(1.2fr)·Col3=직전경주(3fr)·Col4=베팅조합(2fr)**.
- 공통 유틸 `client/src/lib/sectional.ts`(`getSectionalInfo`·`fmtSec`·`computeSameDistStats`) — PredictionSheet·RaceEntries 공유, 페이지에 재구현 금지.
- `/picks` '오늘의 강추' 뷰 + `PickBadge` 강추/주목 칩 + 통계 "선별 적중률" 섹션.
- 로딩 스켈레톤(U-001), RaceInfoBlock 공통 헤더(3화면 공유), JockeyPanel·HorsePanel 개선 완료.

## 다음 후보·남음
- 🔲 E-004 트랙 이동 이력 (서울↔부경) / E-005 연속 완주 여부 → TODO
- 🔲 F-001 페이스 예측(선행마 집계) / F-003 사용자 메모·별표 → TODO
- 🔲 PRD v6.1 Phase 2 — HorseDetail 18항목 원시값+맥락 → TODO
- 🔲 T-011 PRD legend derived 5개 (→ [01-scoring](01-scoring.md) 공유)

## 종결·기각 (요약)
- (없음)

## 참고
- 문서: [PRD_v6.1_entries_view.md](../PRD_v6.1_entries_view.md), [PRD_v6.1_race_info_legend.md](../PRD_v6.1_race_info_legend.md)
- ⚠️ training_logs 함정: `st_time`/`sp_time`=YYYYMMDDHHmmss 타임스탬프, 소요시간은 `tr_term`(초). `pr_gubun` 범례: 이름=기수·조=조교사·관=주로조교·생=교육생·이름(트)=기수트랙라이더. [[reference_training_rider_legend]]
- ⚠️ 부경 g6f/g8f 순위 컬럼 공백 — getSectionalInfo 배열 앞 prepend. [[project_busan_sectional_rank_gap]]
```

- [ ] **Step 2: 슬러그·링크 검증** — 4 슬러그 + PRD 2 + 01 상호링크 존재.
- [ ] **Step 3: 6개 트랙 파일 일괄 커밋**

```bash
git add docs/status/
git commit -m "docs(status): 6개 트랙 STATUS 파일 신규 (진행상황 SSOT)"
```

---

### Task 7: CLAUDE.md — 현재상태/DB현황 → 트랙 인덱스

**Files:**
- Modify: `CLAUDE.md` (현재 "## 📍 진행 상황"이 아니라 "## ⚠️ 현재 상태 (2026-06-26)"부터 "## DB 현황" 끝까지 = 이번 세션 1차 슬림화된 블록)

**Interfaces:**
- Consumes: Task 1~6이 만든 `docs/status/01~06.md` (링크 대상)

- [ ] **Step 1: 현재 블록 확인** — `CLAUDE.md`에서 `## ⚠️ 현재 상태 (2026-06-26)` 헤더부터 파일 끝(`## DB 현황` 섹션 포함)까지가 교체 대상. 상단(요약~문서인덱스)은 불변.

- [ ] **Step 2: 교체** — 해당 블록 전체를 아래로 교체:

```markdown
## 📍 진행 상황 — 트랙별 (SSOT: docs/status/)

> 세션 인계·현재상태는 트랙 파일이 단일 출처. CLAUDE.md는 인덱스만.
> 시간순 전체 → [docs/session_history.md](docs/session_history.md) · 할일 → [TODO.md](TODO.md)

| 트랙 | 파일 | 현재 한 줄 |
|---|---|---|
| 점수·알고리즘 | [01-scoring](docs/status/01-scoring.md) | 로지스틱 직접학습 · ⑧ 부담중량 자문 대기 |
| 예측모델·벤치마크 | [02-model-benchmark](docs/status/02-model-benchmark.md) | 활성 id=6 logistic · `npm run benchmark` 롤링통합 |
| 시장엣지·전략 | [03-market-edge](docs/status/03-market-edge.md) | 선별표시·Platt 배포 · 공개피처 격파 종결 |
| 신호발굴 | [04-signals](docs/status/04-signals.md) | class_move 채택 · 조교 흡수확정 |
| 데이터인프라 | [05-data-infra](docs/status/05-data-infra.md) | DuckDB 미러 · egress 주의 · 조교 376k |
| UI·화면 | [06-ui](docs/status/06-ui.md) | 예상지 4열 · `/picks` 선별표시 |
```

- [ ] **Step 3: 문서 인덱스에 status 디렉토리 추가** — `## 📚 문서 인덱스`의 "세션 인계" 항목 근처에 한 줄:

```markdown
- [docs/status/](docs/status/) — **트랙별 진행상황 SSOT** (점수·모델·엣지·신호·인프라·UI)
```

- [ ] **Step 4: 링크 검증** — Run: `grep -oE 'docs/status/[0-9]+-[a-z-]+\.md' CLAUDE.md` → 6개 링크 전부 실제 파일과 매칭. Expected: 6/6.
- [ ] **Step 5: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs(claude): 현재상태/DB현황 → 트랙 인덱스로 교체"
```

---

### Task 8: npm 감사 — package.json 정리

**Files:**
- Modify: `package.json` (scripts)
- Modify: `docs/status/05-data-infra.md` (제거된 명령이 운영 명령이면 참고에 메모 — 해당 없으면 skip)

- [ ] **Step 1: 깨진 스크립트 재확인** — Run:

```bash
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8")).scripts;for(const[k,v]of Object.entries(p)){const m=v.match(/tsx\s+(\S+\.ts)/);if(m&&!fs.existsSync(m[1]))console.log(k,"->",m[1])}'
```

Expected (6개):
```
sync:full -> src/sync/onboardingSync.ts
sync:sectional -> src/sync/sectionalSync.ts
exp:logistic -> scripts/experiment_logistic.ts
probe:edge -> scripts/probe_market_edge.ts
probe:corr -> scripts/probe_feature_corr.ts
exp:pl -> scripts/experiment_pl.ts
```

- [ ] **Step 2: package.json scripts에서 6개 항목 삭제** — 판정 근거: `exp:logistic`·`probe:edge`·`probe:corr`·`exp:pl`=일회성 실험, 파일 archive에 보존(필요시 `tsx scripts/archive/<f>.ts` 직접실행). `sync:full`(onboardingSync)·`sync:sectional`(sectionalSync)=대상 파일 자체 소멸=죽은 명령. 6개 모두 **REMOVE-npm**. 다음 라인 삭제:

```
"sync:full": "tsx src/sync/onboardingSync.ts",
"sync:sectional": "tsx src/sync/sectionalSync.ts",
"exp:logistic": "tsx scripts/experiment_logistic.ts",
"exp:pl": "tsx scripts/experiment_pl.ts",
"probe:edge": "tsx scripts/probe_market_edge.ts",
"probe:corr": "tsx scripts/probe_feature_corr.ts",
```

- [ ] **Step 3: 재확인 — 깨진 항목 0** — Run Step 1 명령 다시. Expected: (출력 없음).
- [ ] **Step 4: JSON 유효성 + 타입체크** — Run: `node -e "JSON.parse(require('fs').readFileSync('package.json'))" && npm run build`. Expected: JSON 파싱 OK + tsc 에러 없음(코드 무변경이라 기존 상태 유지).
- [ ] **Step 5: 커밋**

```bash
git add package.json
git commit -m "chore(npm): 깨진 스크립트 6개 제거 (대상 파일 archive 이동/소멸)"
```

---

### Task 9: scripts 루트 임시·일회성 파일 정리

**Files:**
- Delete: `scripts/_check_accuracy_tmp.ts`, `scripts/_dbg2.ts`

- [ ] **Step 1: 두 파일이 어디서도 import/참조 안 되는지 확인** — Run: `grep -rn "_check_accuracy_tmp\|_dbg2" --include=*.ts --include=*.json .`. Expected: 정의 파일 외 참조 0 (package.json에도 없음).
- [ ] **Step 2: 삭제** — Run: `git rm scripts/_check_accuracy_tmp.ts scripts/_dbg2.ts`.
- [ ] **Step 3: 루트 잔여 일회성 스크립트 점검** — Run: `ls scripts/*.ts`. 운영 패턴(sync_·backfill_·benchmark_·learn_·promote_·verify_·refresh_·build_·fetch_·collect_·backtest_·extract_·upload_·calibration_·recalibration_·fit_live_·probe_selective_·apply_·accuracy_stats·final_stats·weight_grid_search·full_horseinfo·fetch_pedigree)에 **안 맞는** 파일만 archive 이동 후보로 보고. (판정 모호하면 사용자 확인 — 이동은 보수적으로.)
- [ ] **Step 4: 커밋**

```bash
git add -A scripts/
git commit -m "chore(scripts): 루트 임시 파일(_tmp·_dbg) 삭제"
```

---

### Task 10: session_history 타임라인화

**Files:**
- Modify: `docs/session_history.md`

- [ ] **Step 1: 트랙 파일에 누락된 세션 인사이트 없는지 교차확인** — Task 1~6 트랙 파일과 session_history 9개 세션 블록을 대조. 각 세션의 핵심 결론이 어느 트랙엔가 들어갔는지 확인(고아 0). 누락 발견 시 해당 트랙 파일에 한 줄 추가 후 그 파일 재커밋.
- [ ] **Step 2: session_history를 타임라인으로 축약** — 각 `## YYYY-MM-DD — 제목` 블록의 상세 본문을 1~2줄(배포물 + 트랙 링크)로 축약. 예:

```markdown
## 2026-06-25 — 선별 표시·베팅 (트랙 C)
강추/주목 라벨 + /picks + 통계 섹션 배포. 상세 → [03-market-edge](status/03-market-edge.md) · [[project_selective_picks]]

## 2026-06-14 — 롤링 벤치마크 통합
benchmark ← walkforward 흡수·삭제. 상세 → [02-model-benchmark](status/02-model-benchmark.md)
```

상단 안내문을 "시간순 타임라인. 트랙별 상세는 docs/status/."로 갱신.

- [ ] **Step 3: 링크 검증** — Run: `grep -oE 'status/[0-9]+-[a-z-]+\.md' docs/session_history.md` → 참조된 트랙 파일 전부 존재. Expected: 매칭 OK.
- [ ] **Step 4: 커밋**

```bash
git add docs/session_history.md
git commit -m "docs(history): session_history 타임라인화 (상세는 트랙으로 이주)"
```

---

### Task 11: 메모리 cross-link + 최종 검증

**Files:**
- Modify: `C:/Users/mjy76/.claude/projects/C--Users-mjy76-Documents-projectFolder/memory/MEMORY.md` (상단에 트랙 인덱스 포인터 한 줄)

- [ ] **Step 1: MEMORY.md 상단에 트랙 인덱스 포인터 추가** — 첫 줄 위/아래에:

```markdown
- [트랙별 진행상황](../../../../Documents/projectFolder/docs/status/) — 점수·모델·엣지·신호·인프라·UI STATUS 파일 (현재상태 SSOT). 메모리는 회상 인덱스.
```

(경로는 메모리 디렉토리 기준 상대경로 — 안 맞으면 절대 표기 `C:/Users/mjy76/Documents/projectFolder/docs/status/`)

- [ ] **Step 2: 전체 링크 무결성 검증** — Run:

```bash
grep -rhoE '\]\(([^)]+\.md)\)' docs/status/ | sed -E 's/.*\(([^)]+)\)/\1/' | while read p; do test -e "docs/status/$p" || test -e "$p" || echo "BROKEN: $p"; done
```

Expected: BROKEN 출력 0 (상대경로가 docs/status/ 기준으로 해석되는지 확인 — 안 맞으면 docs/ 기준 재검).

- [ ] **Step 3: 메모리 슬러그 전수 검증** — Run: `grep -rhoE '\[\[[a-z_]+\]\]' docs/status/ | sort -u` → 각 슬러그가 MEMORY.md에 존재하는지 대조. Expected: 미존재 슬러그 0.
- [ ] **Step 4: 커밋** (메모리는 별도 워킹디렉토리)

```bash
cd "C:/Users/mjy76/.claude/projects/C--Users-mjy76-Documents-projectFolder/memory" && git add MEMORY.md 2>/dev/null; cd -
# 메모리가 git 미추적이면 커밋 skip — 파일 저장만으로 충분
```

- [ ] **Step 5: 최종 보고** — 변경 요약: 신규 6 트랙파일 / CLAUDE.md·session_history·TODO·package.json·scripts 변경 / 삭제·제거 항목. `git log --oneline chore/docs-restructure` 으로 커밋 7개 확인.

---

## 미반영(별건) — 스펙 §9 비목표
- 메모리 [[project_*]] 통합/삭제 · data/ 임시파일 · 중복 docs 통합 — 적극정리 강도에서.

## 실행 후 결정
- `chore/docs-restructure` → main 머지 (`finishing-a-development-branch`).
