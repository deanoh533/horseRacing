# 문서 구조 재편 + npm/파일 감사 설계

**날짜:** 2026-06-26
**브랜치:** `chore/docs-restructure` (신규)
**목표:** 진행상황이 4곳에 중복·드리프트된 문제를 트랙별 SSOT로 재편하고, 깨진 npm 명령·난잡한 스크립트를 감사한다.

---

## 1. 배경 — 왜

진행상황(progress/status)이 **4개 출처에 흩어져 중복·상충**한다:

1. `CLAUDE.md` "현재 상태" — 매 세션 인계 노트가 누적 (이번 세션 1차 슬림화함)
2. `docs/session_history.md` — 시간순 세션 기록 (122줄·9세션)
3. 메모리 `MEMORY.md` + `[[project_*]]` ~30개 — 주제별 요약
4. `TODO.md` — 우선순위 할일

같은 사실(예: 활성 모델 id, 선별표시 트랙, 조교 흡수)이 여러 곳에 다른 시점·다른 표현으로 박혀, 무엇이 최신인지 알 수 없다.

또 `package.json` 53개 npm 스크립트 중 **최소 4개가 archive로 옮겨진 파일을 가리켜 실행 불가**이고, 루트에 임시 스크립트가 잔존한다. 2026-06-12에 한 번 정리했으나 이후 재드리프트.

**성공 기준:**
- 진행상황의 "현재 상태"가 **트랙별 단일 파일**에 산다 (어디를 봐야 할지 1초에 안다)
- 4개 출처 각각의 **역할이 겹치지 않게** 재정의된다
- `package.json`에 깨진/안 쓰는 npm 명령이 0개
- 루트 `scripts/`에 임시·일회성 파일 0개 (archive로 이동, 삭제 아님)

---

## 2. 핵심 설계 — 4개 출처의 역할 재배정

이게 이 작업의 심장이다. "또 다른 중복(5번째)"을 안 만들려면 각 출처가 **한 가지 역할**만 갖는다.

| 출처 | 새 역할 (단일 책임) | 무엇이 사라지나 |
|---|---|---|
| **`CLAUDE.md`** | 안정 레퍼런스(스택·테이블·흐름) + **트랙 인덱스 표**(링크만) | "현재 상태/DB현황" 진행 디테일 → 트랙 파일로 이주 |
| **`docs/status/01~06.md`** (신규) | **트랙별 "현재 상태 + 다음 + 종결요약"의 SSOT** | (신규) |
| **`docs/session_history.md`** | **시간순 타임라인** — 세션당 1~2줄(날짜→배포물→트랙링크) | 세션별 상세 본문 → 트랙 파일로 발굴·이주, 타임라인만 남김 |
| **메모리 `[[project_*]]`** | **세션 간 회상 인덱스**(AI recall) — 트랙 파일과 상호 링크 | 통합 안 함(이번 강도 밖). 트랙 파일이 가리키도록 cross-link만 |
| **`TODO.md`** | **실행 가능한 할일 백로그**(ID 부여: E/F/T/L/Q) | 완료 항목 제거 |

**중복 방지 규칙 (TODO ↔ 트랙 파일):**
- 구체적·실행가능 할일은 **TODO.md가 소유**(ID로 추적).
- 트랙 파일 "다음 후보"는 **TODO ID를 가리키는 포인터** + 아직 TODO화 안 된 트랙 고유 연구 방향만.
- 같은 항목을 양쪽에 본문으로 적지 않는다.

---

## 3. 트랙 정의 (6개) + 출처 매핑

`docs/status/` 아래 6개 파일. 각 파일은 §4 공통 템플릿을 따른다.

| # | 파일 | 트랙 | 흡수할 출처 (메모리 / 세션 / TODO) |
|---|---|---|---|
| 01 | `01-scoring.md` | 점수·알고리즘 | score_roadmap·running_style_classification·running_style_pace_map·weight_versioning / 06-02·06-06 / T-005·T-011·T-012·Q-001~003 |
| 02 | `02-model-benchmark.md` | 예측모델·벤치마크 | market_benchmark·speed_figure·rolling_benchmark_integration·score_learning_redesign / 06-03·06-11·06-12×2·06-14 / (model_versions 영구화) |
| 03 | `03-market-edge.md` | 시장엣지·전략 | market_edge_strategy·market_dominance_ceiling·benter_blend·selective_picks / 06-25 / (B 조건부엣지·선별 고도화) |
| 04 | `04-signals.md` | 신호발굴 | feature_gate_findings·training_signals·medical_signals·gate_multimetric·no_human_compression / 06-10·06-11 / — |
| 05 | `05-data-infra.md` | 데이터인프라 | duckdb_local_mirror·local_first_over_db·pipeline_guide·kra_dividend_api·earnings_asof_leak·db_schema_gotchas / 06-12 / L-001~005·T-013·win_odds시계열 |
| 06 | `06-ui.md` | UI·화면 | unused_race_entry_fields·training_rider_legend·busan_sectional_rank_gap·betting_terms / — / E-004·E-005·F-001·F-003·T-011·PRD Phase2 |

매핑 검증: 메모리 30개·세션 9개·TODO 항목 전부가 정확히 한 트랙에 귀속됨(고아 0).

> 경계 케이스: **Platt 라이브 캘리브레이션**은 모델(02)과 엣지전략(03) 사이. → **03(시장엣지)에 둔다**(서비스 캘리브레이션 = 엣지 트랙 C2 정체성). 02에서는 한 줄 + 03 링크.

---

## 4. 트랙 파일 공통 템플릿

```markdown
# <트랙명> — 진행 상황
> 마지막 업데이트: YYYY-MM-DD · 관련 메모리: [[slug]], [[slug]]

## 현재 상태
지금 어디까지 왔나 (1~3줄, 활성 모델/배포 상태 등 핵심 사실).

## 다음 후보 / 남음
- 🔲 ... (TODO ID 있으면 `→ TODO L-001` 포인터)

## 종결·기각 (요약)
- ✅/❌ <시도> — 한 줄 결론 + 근거 (`docs/...` 또는 커밋 링크)

## 참고
- 메모리: [[project_xxx]]
- 문서/스펙: docs/..., docs/superpowers/specs/...
```

규칙: **상세 산식·실측 수치는 기존 문서(score_roadmap·accuracy_metrics·전략문서)가 SSOT**. 트랙 파일은 "현재 상태 + 포인터"만. 트랙 파일에 수치를 재기재하지 않는다(또 다른 드리프트 방지).

---

## 5. CLAUDE.md 변경

- §"현재 상태 (2026-06-26)" + §"DB 현황" 블록을 → **트랙 인덱스 표**로 교체:

```markdown
## 📍 진행 상황 — 트랙별 (SSOT: docs/status/)
> 세션 인계·현재상태는 트랙 파일이 단일 출처. CLAUDE.md는 인덱스만.

| 트랙 | 파일 | 현재 한 줄 |
|---|---|---|
| 점수·알고리즘 | [01](docs/status/01-scoring.md) | … |
| 예측모델·벤치마크 | [02](docs/status/02-model-benchmark.md) | 활성 id=6 logistic · npm run benchmark |
| 시장엣지·전략 | [03](docs/status/03-market-edge.md) | 선별표시·Platt 배포 · 공개피처 격파 종결 |
| 신호발굴 | [04](docs/status/04-signals.md) | class_move 채택 · 조교 흡수 |
| 데이터인프라 | [05](docs/status/05-data-infra.md) | DuckDB 미러 · egress 주의 |
| UI·화면 | [06](docs/status/06-ui.md) | 예상지 4열 · /picks |

> 시간순 전체 → docs/session_history.md · 할일 → TODO.md
```

- 상단 안정 섹션(요약·4단계 흐름·스택·개발시작·핵심테이블·예측모드·주간흐름·협업·문서인덱스)은 **불변**.
- 문서 인덱스에 `docs/status/` 디렉토리 한 줄 추가.

---

## 6. npm 감사 (53개 → 분류)

`package.json` scripts 53개를 3분류:

- **KEEP**: 운영/상시 사용 (sync·backfill·benchmark·build·test·client·db:pull·probe:picks·calib:fit-live·training:upload 등)
- **경로수정**: 가리키는 파일이 이동했으나 여전히 유효 → 경로 갱신
- **REMOVE-npm**: 가리키는 파일이 archive行(일회성 실험) → npm 항목 삭제 (파일은 archive 보존)

**확정 깨진 항목 (REMOVE-npm 후보):**
| npm | 가리키는 경로 | 실제 위치 |
|---|---|---|
| `exp:logistic` | scripts/experiment_logistic.ts | scripts/archive/ |
| `probe:edge` | scripts/probe_market_edge.ts | scripts/archive/ |
| `probe:corr` | scripts/probe_feature_corr.ts | scripts/archive/ |
| `exp:pl` | scripts/experiment_pl.ts | scripts/archive/ |

> 분류표 전체는 구현 계획에서 53개 1행씩 작성·검증(각 경로 존재 여부 + 종결 트랙 여부로 판정).

---

## 7. 파일 감사 (scripts/ 루트)

- **삭제**: `scripts/_check_accuracy_tmp.ts`, `scripts/_dbg2.ts` (임시·디버그)
- **archive 이동 검토**: 루트로 흘러든 일회성 스크립트 — 운영 패턴(`sync_*`·`backfill_*`·`benchmark_*`·`learn_*`·`promote_*`·`verify_*`·`refresh_*`·`build_*`·`fetch_*`·`collect_*`·`backtest_*`·`extract_*`·`upload_*`·`calibration_*`·`recalibration_*`·`fit_live_*`·`probe_selective_*`·`apply_*`·`accuracy_stats`·`final_stats`·`weight_grid_search`)에 안 맞는 것만 이동.
- **범위 밖(이번 강도 = 수정+이동)**: `data/` 임시·백업 파일, 메모리 통합, 중복 문서 통합 → 적극정리 강도에서 별건.

---

## 8. 실행·커밋 전략

브랜치 `chore/docs-restructure`. 커밋 분리:
1. `docs(status): 6개 트랙 STATUS 파일 신규 (진행상황 SSOT)`
2. `docs(claude): 현재상태 → 트랙 인덱스로 교체`
3. `docs(history): session_history 타임라인화 (상세는 트랙으로 이주)`
4. `docs(todo): 완료 항목 제거 + 트랙 포인터 정합`
5. `chore(npm): 깨진/미사용 스크립트 정리`
6. `chore(scripts): 루트 임시·일회성 파일 정리`
7. 메모리 cross-link 갱신(별도, 메모리 디렉토리)

각 커밋 전 `npm run build`(타입체크) — 단 문서 커밋은 코드 무영향이므로 npm 커밋에서만 빌드 검증.

---

## 9. 비목표 (YAGNI)

- 메모리 [[project_*]] 통합/삭제 (이번 강도 밖)
- data/ 임시파일 정리 (적극정리 강도)
- 중복 docs(architecture·data_flow·pipeline_guide 등) 통합 (별건, 신중 필요)
- 새 자동화·툴링
