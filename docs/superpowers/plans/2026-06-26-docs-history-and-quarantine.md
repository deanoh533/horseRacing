# 살아있는 히스토리 + 미사용 문서 격리 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 흩어진 변천사를 `docs/history/`(README+modeling-history+service-evolution) 살아있는 문서로 정리하고, 죽은 scripts/archive·완료 specs/plans를 `_trash/`(gitignore)로 격리한다.

**Architecture:** `docs/history/`는 `docs/status/`(지금)의 짝(여기까지). 4갈래 중 데이터흐름·지표변천은 기존 정본 링크, 모델링·서비스 변천만 신규. 격리는 ripgrep이 존중하는 `.gitignore` 폴더로 이동(디스크 보존). 순서: Phase B 작성(원본 출처 사용) → Phase A 격리 → `_archive` 확인 게이트.

**Tech Stack:** Markdown. git. `.gitignore`. 검증은 파일존재·grep 링크체크.

## Global Constraints

- 신규 경로: `docs/history/README.md`, `docs/history/modeling-history.md`, `docs/history/service-evolution.md`, 격리 폴더 `_trash/`
- 메모리 슬러그 `[[slug]]`는 MEMORY.md 슬러그와 정확히 일치
- 히스토리 문서 원칙: **서사+왜+교훈**, 상세 수치는 정본(score_roadmap·accuracy_metrics·strategy) 링크 — 재기재 금지
- 경계: `docs/status/` 종결 = 한 줄 + history 링크 / `docs/history/` = 서사
- 커밋 한국어 + scope + 푸터(Co-Authored-By/Claude-Session)
- 브랜치 `chore/docs-history-and-quarantine` (스펙 `7fb9c7b` 존재)
- 코드 변경 없음 → 빌드/테스트 불요(문서·설정만). package.json 미변경.

---

### Task 1: docs/history/service-evolution.md (서비스 변천사)

**Files:**
- Create: `docs/history/service-evolution.md`

**출처 (읽어 합성):** `docs/_archive/` 의 옛 기획문서 — `KRA_PRD_v3.0_Final.md`·`KRA_PRD_v4.0_Final.md`·`KRA_PRD_v5.0_Personal.md`·`KRA_PRD_v5.0_Section4_Draft.md`·`KRA_Roadmap_v1.0.md`·`KRA_UIUX_Design_v2.0.md`·`UIUX_Design_v3.0.md`·`KRA_PM_Analysis_v1.0.md`·`KRA_Data_Verification_Report.md` · 현행 `docs/PRD_v6.1_entries_view.md`·`docs/PRD_v6.1_race_info_legend.md` · `docs/session_history.md`(기능 마일스톤)

- [ ] **Step 1: _archive PRD 통독·버전 델타 추출** — 위 `docs/_archive/*` 9개 문서를 Read하여 **PRD 버전별 핵심 변화**를 뽑아라(v3→v4→v5→v6.1 무엇이 바뀌었나: 범위·대상·기능·지표셋). 큰 변화 위주, 세부 문구 복사 금지.

- [ ] **Step 2: 파일 작성** — 아래 골격으로, Step1에서 추출한 PRD 델타를 §2에 채워 작성:

```markdown
# 서비스 변천사 — Service Evolution
> 마지막 업데이트: 2026-06-26 · 정본(현행): [PRD_v6.1](../PRD_v6.1_entries_view.md) · 지금 상태: [docs/status/06-ui](status/06-ui.md)
> 이 문서 = 제품·기능·지표셋이 어떻게 변해왔나의 서사. 현재 화면 상태는 docs/status/06-ui가 SSOT.

## 1. 한눈에 — 버전 타임라인
초기 기획(v3) → 개인용 전환(v5) → 현행(v6.1)로 이어진 큰 줄기 1문단.

## 2. PRD 버전별 변화
(Step1 추출 결과: v3.0 → v4.0 → v5.0(개인용) → v6.1 각 버전의 핵심 변화·범위 축소/확장. 각 2~4줄.)

## 3. 지표셋 진화
초기 평가요소 → 현 21항목으로의 확장. 상세·현황은 [score_roadmap](../score_roadmap.md) §1 링크.

## 4. 주요 기능 도입 타임라인
- 예상지(출마정보 4열) · 구간기록/같은거리 통계 · 조교 이력 패널
- 가중치 버전관리·model_versions (2026-06-02)
- /picks 선별 표시(강추·주목) + Platt 우승/연승% 표시 (2026-06-20~25)
상세 → [docs/status/06-ui](status/06-ui.md) · 모델 변천 → [modeling-history](modeling-history.md)

## 5. UI 변천
UIUX v2 → v3 → 현행(모바일 2+2/데스크탑 4열) 큰 변화. 상세 현황은 docs/status/06-ui.
```

- [ ] **Step 3: 링크 검증** — Run: `cd docs/history && for p in ../PRD_v6.1_entries_view.md ../score_roadmap.md status/06-ui.md modeling-history.md; do test -e "$p" || echo "BROKEN(예정포함): $p"; done` — `modeling-history.md`는 Task 2에서 생성되므로 이 시점 BROKEN 가능(허용, Task 3 최종검증서 확인). 나머지는 존재해야 함.

(커밋은 Task 3 이후 history 3파일 일괄)

---

### Task 2: docs/history/modeling-history.md (모델링·측정 변천사)

**Files:**
- Create: `docs/history/modeling-history.md`

**출처(검증용):** `docs/status/` 6 트랙 종결요약 · `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md`·`2026-06-17-ceiling-attempts-theoretical-review.md` · `docs/session_history.md` · 메모리(아래 슬러그). **아래 초안 내용은 이미 합성돼 있으니, 사실 확인 후 그대로 작성하라.**

- [ ] **Step 1: 파일 작성** — 아래 내용으로:

```markdown
# 모델링·측정 변천사 — 적중률 향상 여정
> 마지막 업데이트: 2026-06-26 · 측정 정본: [accuracy_metrics](../accuracy_metrics.md) · 지표 정본: [score_roadmap](../score_roadmap.md) · 지금 상태: [docs/status](status/)
> 이 문서 = *왜 이 방법들을 거쳐 지금 모델에 왔나*의 서사와 교훈. 상세 수치는 정본 링크, 트랙 현재상태는 docs/status.

## 1. 점수 학습 방식의 변천
- **Spearman 가중치 (v1)** — 항목별 ρ로 가중치 학습. look-ahead 누수 수정으로 옛 적중률이 거품이었음 판명(2026-06-02, 정직 복승 ~58%). [[project_weight_versioning]]
- **수득상금 차원 종결 (2026-06-06)** — 재설계 "+5.2%p"가 전부 earnings 미래누수. 차원 자체 예측력 0. [[reference_earnings_asof_leak]]
- **로지스틱 전체동시학습 (재설계)** — 항목별 ρ→P(top3) 동시 학습. PL·GBM 챔피언전서 **로지스틱 확정, PL/GBM 폐기**. [[project_score_learning_redesign]]
- **⑳ 속도능력지수 (2026-06-03)** — par-time 절대지수, ρ=0.271. v3 후보였으나 미승격. [[project_speed_figure]]
- **class_move 채택 (2026-06-11)** — 등급이동, 다분기 강건(+3.9%p), 라이브 클린. [[project_feature_gate_findings]]
- **Platt 캘리브레이션 (2026-06-20)** — 첫 서비스 캘리브레이션. p_win/p_top3, 랭킹 불변. [[project_market_edge_strategy]]

## 2. 측정·검증 방식의 변천
- 적중률 4지표(단·연·복·TOP3) → **시장 벤치마크 발견**(2026-06-03): 모델이 인기1위에 뒤지고 엇갈릴 때 더 틀림. [[project_market_benchmark]]
- **2단계 게이트 (2026-06-10)**: A=probe:corr(중복제외) → B=backtest:box(holdout ROI). 이후 **3면화**(연승·fade·복승, 2026-06-15). [[feedback_no_human_compression]] · [[project_gate_multimetric]]
- **walkforward → 롤링 벤치마크 통합 (2026-06-14)**: benchmark가 흡수·walkforward 삭제. [[project_rolling_benchmark_integration]]
- **통제 A/B (2026-06-19)**: 같은 스펙 ON/OFF 토글이 승격 판정의 정답. 게이트B 한계기여는 과대보고일 수 있음.

## 3. 신호 발굴 — 채택/기각 대장
| 신호 | 결과 | 근거 |
|---|---|---|
| 등급이동 class_move | ✅ 채택 | 다분기 +3.9%p, 라이브 클린 |
| 조교 train_signal | ❌ 흡수 | 통제 A/B Δ−0.12% [[project_training_signals]] |
| 의료(출혈·피로) | ❌ 기각 | 게이트B 한계기여 ~0 [[project_medical_signals]] |
| 마체중 | ⏸ 보류 | wg_hr 라이브 누수 |
| z·구간6·경쟁강도·장구·기수 | ❌ 탈락 | 다분기 노이즈 |
| Benter 2단계 | ❌ 음성 | 실재하나 무가치(크기 0) [[project_benter_blend]] |

## 4. 메타 교훈 (천장의 구조)
- **시장 천장**: 공개피처로는 승/연승 시장 못 이김(−7~8%p), win_odds를 피처로 넣어도 부가가치 0. [[project_market_dominance_ceiling]]
- **흡수 패턴**: 실측 신호 ≠ 모델 가치. 단변량 양성도 기존 피처에 흡수되면 한계기여 0.
- **게이트B 과대보고 → 통제 A/B로 판정.**
- **"실재하나 무가치한 엣지"**: 방향은 맞아도 크기가 0이면 돌파 아님.
- **공제율**: 엑조틱 26% > 단복승 20% → 엑조틱이 더 어려움.
- 전략 상세: [strategy/2026-06-16](../strategy/2026-06-16-market-edge-and-korean-winning-conditions.md) · [strategy/2026-06-17](../strategy/2026-06-17-ceiling-attempts-theoretical-review.md)
```

- [ ] **Step 2: 사실 확인** — 작성 내용 중 핵심 사실(class_move 채택·조교 흡수·Benter 음성·시장 −7~8%p)이 `docs/status/03-market-edge.md`·`04-signals.md`와 모순 없는지 대조. 모순 시 status 쪽을 정답으로 수정.
- [ ] **Step 3: 슬러그 검증** — Run: `grep -oE '\[\[[a-z_]+\]\]' docs/history/modeling-history.md | sed 's/\[\[//;s/\]\]//' | sort -u` → 각 슬러그가 MEMORY.md에 존재 확인.

---

### Task 3: docs/history/README.md (4갈래 지도) + history 3파일 커밋

**Files:**
- Create: `docs/history/README.md`

**Interfaces:** Consumes: Task 1·2가 만든 `service-evolution.md`·`modeling-history.md`.

- [ ] **Step 1: 파일 작성**

```markdown
# 프로젝트 변천사 (History) — 4갈래 지도
> "지금 상태"는 [docs/status/](../status/), "어떻게 여기까지 왔나"는 여기.

| 갈래 | 정본 문서 | 갱신 트리거 |
|---|---|---|
| 데이터 큰 흐름 | [architecture](../architecture.md)(구조) · [data_flow](../data_flow.md)(흐름) · [pipeline_guide](../pipeline_guide.md)(명령어) | 파이프라인/스크립트 구조 변경 |
| 모델링·측정 변천 | [modeling-history.md](modeling-history.md) | 트랙 채택/기각 확정 |
| 지표 변천 | [score_roadmap](../score_roadmap.md) | 평가항목 추가·산식 변경 |
| 서비스 변천 | [service-evolution.md](service-evolution.md) | 기능·PRD 마일스톤 |

> 시간순 세션 타임라인 → [session_history](../session_history.md)
```

- [ ] **Step 2: 링크 전수 검증** — Run: `cd docs/history && grep -rhoE '\]\(([^)]+\.md)\)' . | sed -E 's/.*\(([^)]+)\)/\1/' | sort -u | while read p; do test -e "$p" || echo "BROKEN: $p"; done` — BROKEN 0이어야 함(이제 modeling·service 둘 다 존재).
- [ ] **Step 3: 커밋**

```bash
git add docs/history/
git commit -m "docs(history): 변천사 docs/history 신설 (README+modeling-history+service-evolution)"
```
(+ 푸터 2줄)

---

### Task 4: 흐름 3문서 역할 선명화

**Files:**
- Modify: `docs/architecture.md`, `docs/data_flow.md`, `docs/pipeline_guide.md`

- [ ] **Step 1: 각 문서 상단에 역할 한 줄 추가** — 각 파일 제목(`# ...`) 바로 다음 줄에:
  - `architecture.md`: `> **역할: 구조 SSOT** (무엇이 있나). 데이터 흐름은 [data_flow](data_flow.md), 명령어는 [pipeline_guide](pipeline_guide.md).`
  - `data_flow.md`: `> **역할: 흐름 SSOT** (데이터가 어떻게 이동하나). 구조는 [architecture](architecture.md), 명령어는 [pipeline_guide](pipeline_guide.md).`
  - `pipeline_guide.md`: `> **역할: 명령어/실행 SSOT**. 구조는 [architecture](architecture.md), 흐름은 [data_flow](data_flow.md).`

- [ ] **Step 2: architecture.md "## 2. 4단계 핵심 흐름" 축소** — `docs/architecture.md`의 `## 2. 4단계 핵심 흐름` 섹션을 Read. 그 안의 상세 단계 서술(다이어그램 제외)을 제거하고, 큰 그림 ASCII 다이어그램 1개만 남긴 뒤 그 아래에 한 줄: `> 단계별 상세 흐름은 [data_flow.md](data_flow.md)가 정본.` (다이어그램이 없으면 한 줄 링크만.)

- [ ] **Step 3: 커밋**

```bash
git add docs/architecture.md docs/data_flow.md docs/pipeline_guide.md
git commit -m "docs(flow): 흐름 3문서 역할 선명화 (구조/흐름/명령어 SSOT)"
```
(+ 푸터)

---

### Task 5: 업데이트 규율 — CLAUDE.md + 메모리

**Files:**
- Modify: `CLAUDE.md` (문서 인덱스)
- Modify: `C:/Users/mjy76/.claude/projects/C--Users-mjy76-Documents-projectFolder/memory/project_docs_architecture.md`

- [ ] **Step 1: CLAUDE.md 문서 인덱스에 history + 갱신 규칙 추가** — `## 📚 문서 인덱스`의 "세션 인계" 항목 근처(docs/status 줄 아래)에:

```markdown
- [docs/history/](docs/history/) — **변천사 SSOT** (모델링·측정 / 서비스 / 지표 / 데이터흐름 4갈래 지도)

> **문서 갱신 규칙:** 트랙 종결/채택 → `docs/history/modeling-history.md` · 지표 변경 → `docs/score_roadmap.md` · 기능 마일스톤 → `docs/history/service-evolution.md` · 파이프라인 구조 변경 → `docs/data_flow.md`. 현재상태는 `docs/status/0N-*.md`.
```

- [ ] **Step 2: 메모리 project_docs_architecture.md 확장** — `How to apply:` 문단 끝에 추가:

```markdown

**변천사(docs/history/):** 트랙 종결/채택 확정 시 `docs/history/modeling-history.md`에 항목 추가(+ status 종결 한 줄). 기능 마일스톤 시 `service-evolution.md`. status=한 줄 종결·history=서사 경계 유지.
```

- [ ] **Step 3: 커밋** (메모리는 별도 디렉토리 — repo 커밋엔 CLAUDE.md만)

```bash
git add CLAUDE.md
git commit -m "docs(claude): 변천사 history 인덱스 + 문서 갱신 규칙 명시"
```
(+ 푸터)

---

### Task 6: Phase A — `_trash/` 격리

**Files:**
- Create: `_trash/` (gitignore), Modify: `.gitignore`
- Move: `scripts/archive/*` → `_trash/scripts/archive/`, `docs/superpowers/archive/*` + 완료 specs/plans → `_trash/docs/superpowers/...`

- [ ] **Step 1: .gitignore에 _trash 추가** — `.gitignore` 끝에 한 줄 추가:

```
# 격리(삭제 대상 staging) — git·검색 제외, 디스크 보존
_trash/
```

- [ ] **Step 2: 격리 대상 목록 확정** — Run하여 목록 확인:

```bash
echo "--- scripts/archive ---"; git ls-files 'scripts/archive/*'
echo "--- superpowers/archive ---"; git ls-files 'docs/superpowers/archive/*'
echo "--- 활성 완료 specs/plans (현행 2건 제외) ---"; git ls-files 'docs/superpowers/specs/*' 'docs/superpowers/plans/*' | grep -vE '2026-06-26-docs-(restructure|history-and-quarantine)'
```
현행 2건(`2026-06-26-docs-restructure*`·`2026-06-26-docs-history-and-quarantine*`)은 **제외**(활성 유지).

- [ ] **Step 3: 물리 이동 + git rm** — 디렉토리 구조 보존하며 `_trash/`로 이동. Bash:

```bash
cd "C:/Users/mjy76/Documents/projectFolder"
mkdir -p _trash/scripts _trash/docs/superpowers
# scripts/archive 통째
git mv -k scripts/archive "_trash/scripts/archive" 2>/dev/null || { mkdir -p _trash/scripts && cp -r scripts/archive _trash/scripts/ && git rm -r scripts/archive; }
# superpowers/archive 통째
git mv -k docs/superpowers/archive "_trash/docs/superpowers/archive" 2>/dev/null || { mkdir -p _trash/docs/superpowers && cp -r docs/superpowers/archive _trash/docs/superpowers/ && git rm -r docs/superpowers/archive; }
# 활성 완료 specs/plans (현행 2건 제외) 개별 이동
for f in $(git ls-files 'docs/superpowers/specs/*' 'docs/superpowers/plans/*' | grep -vE '2026-06-26-docs-(restructure|history-and-quarantine)'); do
  mkdir -p "_trash/$(dirname "$f")"; cp "$f" "_trash/$f"; git rm "$f";
done
```
주의: `git mv`가 gitignore 대상으로의 이동을 거부하면 위 폴백(cp + git rm)이 동작. 이동 후 `_trash/`는 gitignore라 untracked.

- [ ] **Step 4: 검증** — Run:
```bash
git ls-files 'scripts/archive/*' 'docs/superpowers/archive/*' | wc -l   # 0 이어야
ls _trash/scripts/archive/*.ts | wc -l                                   # 35 근처
git ls-files 'docs/superpowers/specs/*' 'docs/superpowers/plans/*'       # 현행 2건씩만 남아야
grep -rl 'scripts/archive' --include='*.md' docs/ 2>/dev/null            # 잔존 참조 보고(있으면 후속)
```

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "chore(trash): scripts/archive·완료 specs·plans → _trash 격리 (gitignore)"
```
(+ 푸터)

---

### Task 7: `_archive` 옛 PRD 격리 (확인 게이트)

**Files:**
- Move: `docs/_archive/*` → `_trash/docs/_archive/`

- [ ] **Step 1: service-evolution.md 보존 확인** — `docs/history/service-evolution.md`가 `_archive` PRD의 핵심 변천을 담았는지 확인(§2 PRD 버전별 변화가 비어있지 않은지). 비어있으면 STOP·BLOCKED 보고(히스토리 보존 전 격리 금지).
- [ ] **Step 2: 컨트롤러 확인 게이트** — 이 Task는 **컨트롤러(메인)가 사용자 확인을 받은 뒤** 실행. 서브에이전트는 여기서 멈추고 "service-evolution 보존 확인됨, _archive 격리 대기" 보고.
- [ ] **Step 3 (확인 후): 이동 + git rm**

```bash
cd "C:/Users/mjy76/Documents/projectFolder"
mkdir -p _trash/docs
git mv -k docs/_archive "_trash/docs/_archive" 2>/dev/null || { cp -r docs/_archive _trash/docs/ && git rm -r docs/_archive; }
git ls-files 'docs/_archive/*' | wc -l   # 0
```

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "chore(trash): 옛 PRD docs/_archive → _trash 격리 (service-evolution 보존 후)"
```
(+ 푸터)

---

## 자체검토 메모
- 스펙 §2~§5 전부 Task 1~7 매핑. §6 비목표(data·메모리통합·데드코드·실제삭제) 미반영 확인.
- Task 1(service-evolution)은 _archive 통독 필요 = 실제 합성. Task 2(modeling-history)는 초안 제공 = 검증·전사.
- Task 7은 확인 게이트(히스토리 보존 후 _archive 격리) — 사용자 승인 필수.

## 실행 후
- `chore/docs-history-and-quarantine` → main 머지 (`finishing-a-development-branch`).
```
