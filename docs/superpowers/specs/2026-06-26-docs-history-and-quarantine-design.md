# 살아있는 히스토리 문서(docs/history/) + 미사용 문서 격리 설계

**날짜:** 2026-06-26
**브랜치:** `chore/docs-history-and-quarantine` (신규)
**선행:** `2026-06-26-docs-restructure-design.md`(docs/status/ 트랙 SSOT) 완료·main 머지.
**목표:** ① 흩어진 "프로젝트 변천사"를 살아있는(계속 갱신되는) `docs/history/`로 정리하고, ② 더 이상 참조 안 되는 문서·스크립트를 git·검색에서 빠지는 격리 폴더로 옮긴다.

---

## 1. 배경

`docs/status/`로 "지금 상태"는 트랙별 SSOT가 됐다. 그러나 사용자가 보존하길 원하는 **변천사**(어떻게 여기까지 왔나)는 여전히 흩어져 있다:
- 모델링·측정 방식의 역사 → `docs/status/` 종결요약 + `strategy/` + 메모리 + 곧 격리할 specs/plans에 분산
- 서비스·기능·지표셋의 변천 → `_archive` 옛 PRD + `session_history` 마일스톤에 분산

동시에 죽은 무게가 git·검색에 계속 잡힌다: `scripts/archive/`(35) · 완료 specs/plans(활성 13 + archive 29).

**성공 기준:**
- "변천사"를 보려면 `docs/history/` 한 곳에서 출발한다(4갈래 지도).
- 새 트랙 종결·지표 변경·기능 마일스톤 발생 시 **어느 히스토리 문서를 갱신할지**가 규칙으로 박혀 있다.
- 죽은 문서·스크립트가 `git ls-files`·ripgrep 검색에서 0건으로 빠진다(디스크엔 보존, 복구 가능).

---

## 2. Phase B — `docs/history/` (살아있는 변천사)

### 2-1. 구조
```
docs/history/
├── README.md              ← 4갈래 지도: 각 갈래의 정본 문서 링크
├── modeling-history.md    ← 신규: 적중률 향상 모델링·측정 방식 변천사 + 교훈
└── service-evolution.md   ← 신규: 서비스·기능·지표셋 변천 (PRD v1~v6.1)
```
- **데이터 흐름** 갈래 → 정본 = `architecture.md`/`data_flow.md`/`pipeline_guide.md` (이동 X, README에서 링크).
- **지표 변천** 갈래 → 정본 = `score_roadmap.md` (이미 변경이력 Living Doc, 이동 X, README 링크).

### 2-2. README.md (4갈래 지도)
각 갈래에 한 줄 설명 + 정본 문서 링크 + "이 갈래가 갱신되는 트리거"를 명시.

| 갈래 | 정본 문서 | 갱신 트리거 |
|---|---|---|
| 데이터 큰 흐름 | architecture(구조)·data_flow(흐름)·pipeline_guide(명령어) | 파이프라인/스크립트 구조 변경 시 |
| 모델링·측정 변천 | history/modeling-history.md | 트랙 채택/기각 확정 시 |
| 지표 변천 | score_roadmap.md | 평가항목 추가·산식 변경 시 |
| 서비스 변천 | history/service-evolution.md | 기능·PRD 마일스톤 시 |

### 2-3. modeling-history.md (신규)
**무엇:** *왜 이 방법들을 거쳐 지금 모델(id=6 logistic + Platt)에 왔나*의 시간순/주제별 서사 + 메타 교훈.
**출처(읽어 합성):** `docs/status/` 6 트랙 종결요약 · `docs/strategy/2026-06-16`·`2026-06-17` · 메모리 `project_benter_blend`·`project_market_dominance_ceiling`·`project_market_edge_strategy`·`project_training_signals`·`project_medical_signals`·`project_feature_gate_findings`·`project_speed_figure`·`project_score_learning_redesign`·`project_rolling_benchmark_integration` · `session_history.md` · 격리 전 specs/plans 요지.
**줄기(섹션):**
- 점수 학습: Spearman 가중치 → 로지스틱 전체동시학습(PL·GBM 폐기) → Platt 캘리브레이션.
- 측정 방식: 적중률 4지표 → Gate A/B → walkforward → 롤링 벤치마크(통합) → 통제 A/B.
- 신호 발굴 여정: class_move 채택 / 조교·의료·마체중 등 기각·보류.
- **메타 교훈:** 시장 천장 · 흡수 패턴(실측신호≠모델가치) · 게이트B 과대보고 → 통제 A/B로 판정 · "실재하나 무가치한 엣지".
**원칙:** 상세 수치는 정본(accuracy_metrics·score_roadmap·strategy) 링크. 여기는 *서사+왜+교훈*.

### 2-4. service-evolution.md (신규)
**무엇:** 제품/기능/지표셋의 버전 변천.
**출처:** `docs/_archive/` 옛 PRD(v3→v4→v5→v6.1)·Roadmap v1·UIUX v2/v3·PM분석 · `session_history` 기능 마일스톤 · 현 `PRD_v6.1_*`.
**줄기:** PRD 버전별 핵심 변화 / 지표셋 진화(초기 → 21항목) / 주요 기능 도입 타임라인(예상지·구간기록·조교이력·/picks 선별표시·Platt 표시) / UI 변천.

### 2-5. 중복 방지 경계 (확정)
- **status** = 트랙별 *현재 상태 + 다음*. 종결은 **한 줄 + history 링크**.
- **history/modeling-history** = *전체 서사 + 교훈*. 상세 수치는 정본 링크.
- 겹침 = status의 한 줄 포인터뿐(의도적, at-a-glance용). 본문 중복 금지.

---

## 3. 흐름 3문서 역할 선명화

3개 유지하되 겹치는 "흐름" 서술을 정본 하나로 모은다:
- `architecture.md` = **구조 SSOT**. §2 "4단계 핵심 흐름"의 상세 흐름 서술은 축소하고 `data_flow.md` 링크로 대체(큰 그림 다이어그램 1개만 유지).
- `data_flow.md` = **흐름 SSOT** (7단계 파이프라인).
- `pipeline_guide.md` = **명령어/실행 SSOT**.
- 세 문서 상단에 "이 문서의 역할 = X (구조/흐름/명령어), 나머지는 Y·Z 참조" 한 줄 명시.

---

## 4. 업데이트 규율 (살아있게)

`CLAUDE.md` 문서 인덱스 + 메모리 `project_docs_architecture` 확장에 명시:
- 트랙 **종결/채택** 확정 → `docs/history/modeling-history.md` 항목 추가 (+ 해당 status 종결요약 한 줄 갱신).
- **지표 추가·산식 변경** → `docs/score_roadmap.md` (기존 규칙 유지).
- **기능/PRD 마일스톤** → `docs/history/service-evolution.md`.
- **파이프라인/스크립트 구조 변경** → `data_flow.md`(+ 필요시 pipeline_guide).

---

## 5. Phase A — 미사용 문서·스크립트 격리

### 5-1. 메커니즘
- repo 루트에 `_trash/` 생성, `.gitignore`에 `_trash/` 추가.
- ripgrep/Glob은 `.gitignore`를 존중 → Claude 검색에서 제외. `git ls-files`에서도 빠짐. 디스크엔 보존(복구 가능).
- 이동 = 물리 이동(원 경로 구조 보존: `_trash/scripts/archive/...`, `_trash/docs/superpowers/...`) 후 `git rm` 원본 → 커밋.

### 5-2. 격리 대상 (확정)
- `scripts/archive/` 35개 (.test 포함 여부 확인 — 운영 스크립트 테스트는 제외).
- 완료 specs/plans: `docs/superpowers/specs/`·`plans/`의 2026-06-26-docs-restructure·**이번 문서(docs-history-and-quarantine)** 를 **제외한** 완료분 + `docs/superpowers/archive/` 전체(specs 14 + plans 15).

### 5-3. 순서 (중요)
① Phase B 문서 작성 완료(specs/plans·_archive 원본이 살아있는 상태에서 출처로 사용) → ② Phase A 격리 → ③ 규율 반영.

### 5-4. `_archive` 옛 PRD (별도, 후순위)
`service-evolution.md` 작성·검토 완료 후 사용자 확인을 받고 `docs/_archive/`(11개)를 `_trash/`로 격리(히스토리 보존 후). 이번 계획에서는 **마지막 단계 + 확인 게이트**로 둔다.

---

## 6. 비목표 (YAGNI)
- `data/` 대용량(local.duckdb·*.jsonl) 정리 — 작업 데이터, 범위 밖.
- 메모리 `[[project_*]]` 통합 — 범위 밖.
- 코드 데드코드 분석 — 범위 밖.
- `_trash/` 실제 삭제 — 사용자가 나중에 수동 결정(이번엔 격리까지만).
