# 프로젝트 전체 정리 설계

**날짜:** 2026-06-12  
**브랜치:** feat/duckdb-local-mirror  
**목표:** 히스토리 정리 + 불필요한 파일 제거 + 코드 일관성 + 토큰 비용 절감

---

## 1. 배경 및 목표

엔진·지표·측정 방향이 여러 차례 바뀌면서 아래 문제가 누적됨:

- `data/` 폴더에 `.bak`, `.gap`, `smoke` 임시 파일 7개 잔존
- `scripts/` 폴더에 일회성 probe/check/test 스크립트 다수 혼재 (60+개)
- `docs/superpowers/` 에 완료/폐기된 specs·plans 누적 (2026-05-28 ~ 2026-06-10)
- `CLAUDE.md` 핵심 이슈 섹션이 5개 세션 히스토리로 비대화 → 새 세션마다 토큰 낭비
- `TODO.md` 완료 항목이 미완료 항목과 혼재

**성공 기준:**
- Claude Code 세션 시작 시 `CLAUDE.md` 로드 토큰이 현재 대비 ~50% 감소
- `scripts/` 루트에는 현재 운영 중인 스크립트만 존재
- `data/` 에 임시 파일 0개
- 활성 specs·plans만 `docs/superpowers/` 루트에 위치

---

## 2. 아키텍처

4개 독립 영역을 병렬 처리. 각 영역 간 의존성 없음.

```
병렬 처리
├── Agent 1: data/ + scripts/archive/
├── Agent 2: docs/superpowers/archive/
├── Agent 3: CLAUDE.md 슬림화
└── Agent 4: TODO.md 정리
```

---

## 3. Agent 1 — data/ 정리 + scripts/archive/ 이동

### 3-1. data/ 삭제 대상

| 파일 | 이유 |
|---|---|
| `data/smoke.jsonl` | 테스트용 임시 파일 |
| `data/training_matrix.q1.bak.jsonl` | Q1 이전 백업 |
| `data/quinella_dividends.q1.bak.jsonl` | Q1 이전 백업 |
| `data/training_matrix.classmove.bak.jsonl` | class_move 실험 백업 |
| `data/quinella_dividends.gap.jsonl` | 갭 임시 파일 |
| `data/quinella_dividends.pre-gap.bak.jsonl` | 갭 이전 백업 |
| `data/training_matrix.gap.jsonl` | 갭 임시 파일 |

**유지:** `training_matrix.jsonl`, `quinella_dividends.jsonl`, `combo_dividends.jsonl`,  
`name_no_map.jsonl`, `race_results_raw.jsonl`, `local.duckdb`, `.gitkeep`

### 3-2. scripts/archive/ 이동 대상 패턴

`check_*.ts`, `probe_*.ts`, `test_*.ts`, `experiment_*.ts`, `analyze_*.ts`

**유지 (운영 스크립트):** `backfill_*.ts`, `sync_*.ts`, `apply_*.ts`, `walkforward_*.ts`,  
`extract_*.ts`, `backtest_*.ts`, `collect_*.ts`, `learn_*.ts`, `promote_*.ts`,  
`verify_*.ts`, `refresh_*.ts`, `build_*.ts`, `fetch_*.ts`,  
`accuracy_stats.ts`, `final_stats.ts`, `weight_grid_search.ts`

---

## 4. Agent 2 — docs/superpowers/archive/ 이동

### 이동 대상

`docs/superpowers/specs/` 및 `docs/superpowers/plans/` 에서  
날짜가 **2026-06-11 이전**인 파일 전부를  
`docs/superpowers/archive/specs/` 및 `docs/superpowers/archive/plans/` 로 이동.

**유지 (현재 진행):**
- `docs/superpowers/specs/2026-06-12-duckdb-local-mirror-design.md`
- `docs/superpowers/plans/2026-06-12-duckdb-local-mirror.md`
- `docs/superpowers/specs/2026-06-12-project-cleanup-design.md` (이 문서)

---

## 5. Agent 3 — CLAUDE.md 슬림화

### 5-1. "핵심 이슈" 섹션 재구성

**현재:** 2026-06-03 ~ 2026-06-12 세션 히스토리 5개 블록 (~200줄)

**변경 후 구조:**

```markdown
## ⚠️ 현재 실행 상태 (2026-06-12)

**브랜치:** feat/duckdb-local-mirror  
**Supabase 제한:** 2026-06-23 리셋 (egress 소진)  
**다음 단계:**
1. db:pull 실행 (6/23 이후)
2. 마체중 직전수집 — KRA 직전정보 API 조사 (가장 유망, gate B +7.2%p)
3. 시장 격차(-8%p) 좁힐 신호 탐색 (다분기 gate B 기준)

**현재 활성 모델:** id=5 (logit-20260611), 연승 60.1% / 단승 28.9%  
**롤백:** 이전 id로 promote

> 세션별 상세 히스토리 → docs/session_history.md
```

### 5-2. 세션 히스토리 분리

`docs/session_history.md` 신규 생성:  
현재 CLAUDE.md의 2026-06-03 ~ 2026-06-11 세션 히스토리 블록 이동.

---

## 6. Agent 4 — TODO.md 정리

- `[x]` 완료 항목 전부 삭제
- 변경 이력 테이블 삭제 (git log 대체)
- 미완료 항목(`[ ]`)만 유지: P0~P3, 런치 게이팅(L-001~L-005), 의문(Q-001~Q-003)
- 상단에 "마지막 정리: 2026-06-12" 추가

---

## 7. 커밋 전략

각 에이전트가 독립 커밋:
- `chore(data): 임시·백업 파일 삭제`
- `chore(scripts): 일회성 탐색 스크립트 archive 이동`
- `chore(docs): 완료된 specs·plans archive 이동`
- `docs(claude): 핵심 이슈 슬림화 + 세션 히스토리 분리`
- `docs(todo): 완료 항목 정리`
