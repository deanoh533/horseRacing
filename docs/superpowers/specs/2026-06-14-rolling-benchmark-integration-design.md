# 롤링 벤치마크 통합 설계 (benchmark ← walkforward)

> 작성: 2026-06-14
> 브랜치: feat/duckdb-local-mirror 위에서 구현
> 선행: [2026-06-12-multi-model-benchmark-design.md](2026-06-12-multi-model-benchmark-design.md)

---

## 1. 배경 — 왜 통합인가

현재 두 검증 도구가 **다른 기준으로 같은 질문**에 답한다.

| | `benchmark_all.ts` | `walkforward_eval.ts` |
|---|---|---|
| 데이터 | DuckDB 로컬 (egress 0) | **Supabase** (egress 소모) |
| 입력 | `gatherRaceInputs → buildFeatures` (원천 재계산) | `predictions.item_scores` (캐시값) |
| 시간 분할 | **고정** (train 2024–25 / test 2026) | **롤링** (분기 확장 윈도우) |
| 채점 모델 | ρ·Logistic·GBDT·PL·시장 | **ρ 가중치만** + 시장 |
| 시장 진단 | 표의 한 행(연/단/복) | **깊음** (불일치·순위별·묶음) |
| 버전 대결 | 없음 (매번 새 학습) | champion vs candidate (`model_versions`) |

### 구조적 어긋남 (지금 당장의 문제)

- **라이브 모델은 이미 Logistic** (`logit-20260611`, id=5).
- 그런데 `walkforward`는 **Spearman ρ 재학습 후보**를 챔피언과 비교한다.
- → "다음 버전이 더 나은가?"를 물어도 **ρ 기준**이라 라이브(Logistic)와 비교 축이 맞지 않는다.
- benchmark는 Logistic을 다루지만 **고정 분할 + 버전 저장 연결 없음**이라 승격 사이클에 못 붙는다.

**결론:** Logistic이 primary가 된 이상, "Logistic 후보 vs Logistic 챔피언 + 시장"을 **롤링으로** 채점하는 단일 경로가 필요하다. benchmark를 그 경로로 통합한다.

---

## 2. 목적

`benchmark_all.ts`를 다음으로 확장한다.

1. **고정 분할 → 롤링 확장 윈도우** (walkforward의 분기 평가 방식 흡수)
2. **시장 깊은 진단 이식** — 불일치 구간 / 순위별 연승 / 상위3 묶음 교집합
3. **챔피언 대결** — `model_versions`의 활성/지정 버전을 후보와 같은 잣대로 채점
4. **Supabase 의존 제거** — walkforward 폐기, 전부 DuckDB ReadClient

비목표(이번 범위 아님):
- Gate A/B 로직 변경 (그대로 유지)
- 새 모델 아키텍처 추가
- promote/저장 자동화 (별도 스크립트 `promote_version.ts` 유지)

---

## 3. 핵심 설계 결정

### 3-1. 롤링 = 모델 전체 재학습 (확장 윈도우)

walkforward는 분기마다 **ρ만** 재학습했다(저렴). 통합 후엔 분기마다 **모든 모델**(ρ·Logistic·GBDT·PL)을 그 시점까지의 데이터로 재학습한다.

```
부트스트랩 2024 전체              → 테스트 안 함
학습 2024            → 테스트 2025-Q1
학습 2024+Q1         → 테스트 2025-Q2
학습 2024+Q1+Q2      → 테스트 2025-Q3
...                                (FIRST_TEST = 2025-Q1)
```

- 비용: DuckDB 오프라인이라 egress 0, CPU만 사용. 분기 수 × 모델 수만큼 fit() 반복.
- 근거: "그 시점에 배포했으면 어땠나"를 현실적으로 시뮬레이션 (look-ahead 누수 차단).

### 3-2. Gate A/B는 롤링과 분리 — 한 번만

Gate A(피처 상관)·Gate B(항목 기여)는 **피처 스크리닝** 단계다. 롤링 루프와 독립.
- 기존대로 고정 holdout(2025-Q4, `GATE_B_HOLDOUT_START/END`)에서 1회 실행.
- 결과 `approvedItems`는 롤링 전 구간 학습에 공통 적용.

### 3-3. 챔피언 = 저장된 가중치, 후보 = 블록별 재학습

| 역할 | 정의 | 채점 |
|---|---|---|
| 챔피언 | `model_versions` 활성/`--champion id` | 저장된 모델 그대로 (재학습 X) |
| 후보 | 블록별 확장 윈도우 재학습 | 각 분기 학습 결과 |
| 기준선 | 시장(인기1위) + ρ(추세) | 상시 |

- 챔피언이 Logistic이면 `model_versions`에 **계수·스키마**가 있어야 채점 가능 → §5 스키마 확장 필요.
- 챔피언이 ρ면 기존 `weights` 딕셔너리로 채점 (하위호환).

### 3-4. 단일 잣대 = top-1 픽의 연승(ord≤3)

walkforward와 동일하게 **1순위 예측마의 연승**을 주 지표로. 단승(ord==1)·2착내(ord≤2)는 참고. 복승(quinella)은 benchmark 기존 표 유지.

---

## 4. 실행 인터페이스

```bash
npm run benchmark                      # 전체: Gate A/B + 롤링 + 시장 깊은 진단
npm run benchmark -- --champion 5      # 챔피언 버전 지정 (기본 = 활성)
npm run benchmark -- --gate-only       # Gate A/B만 (새 피처 추가 시 빠른 점검)
npm run benchmark -- --no-gate         # 롤링 평가만 (피처 확정 후)
```

`walkforward_eval.ts` + `npm run walkforward` 스크립트는 **삭제**. CLAUDE.md·pipeline_guide·accuracy_metrics 문서에서 참조 제거/대체.

---

## 5. 데이터 모델 변경 — `model_versions`

챔피언이 Logistic일 때 재학습 없이 채점하려면 모델 파라미터가 저장돼야 한다.

| 컬럼 | 용도 | 기존/신규 |
|---|---|---|
| `weights` (jsonb) | ρ 가중치 딕셔너리 | 기존 |
| `model_type` (text) | `'spearman'`/`'logistic'`/`'gbdt'`/`'pl'` | **신규** |
| `feature_schema` (jsonb) | 피처 이름 배열 (벡터 정렬용) | **신규** |
| `params` (jsonb) | 계수·트리 등 모델별 파라미터 | **신규** |

- 마이그레이션: `model_type` 기본값 `'spearman'`로 기존 행 하위호환.
- ⚠️ Supabase 쓰기는 6/23 egress 리셋 이후. **로컬 DuckDB 미러에도 동일 컬럼** 반영 필요(`db:pull` 스키마).
- id=5(현 라이브 Logistic)는 `params`가 비어 있을 수 있음 → 채점 시 비면 **건너뛰고 경고**, ρ 챔피언만 비교(점진 이행).

---

## 6. 코드 구조

`benchmark_all.ts`(560줄)에 walkforward를 합치면 비대해진다. **파일 분리**로 해결.

```
src/engine/eval/
  collect.ts        collectRaces (benchmark에서 이동)
  gateA.ts          runGateA / printGateA
  gateB.ts          runGateB / printGateB
  models.ts         trainAllModels / learnSpearman / 모델 dispatch
  rolling.ts        ★신규: 확장 윈도우 루프 + 분기 집계
  market.ts         ★신규(walkforward 이식): 불일치·순위별·묶음 진단
  champion.ts       ★신규: model_versions 로드 + 타입별 채점 dispatch
  report.ts         printReport (ASCII)
scripts/benchmark_all.ts   얇은 오케스트레이터 (인자 파싱 → 위 모듈 호출)
```

`scripts/walkforward_eval.ts` 삭제, 시장 진단 함수(`favoritePick`/`rankByOdds`/불일치·순위별·묶음)는 `market.ts`로 이식.

---

## 7. 출력 리포트 (통합 후)

```
=== Gate A: 피처 상관 경고 ===            (--no-gate 시 생략)
=== Gate B: 항목 포함 현황 ===

=== 롤링 연승률 (분기별, 1순위 픽 3착내) ===
방법            │ 25Q1 │ 25Q2 │ 25Q3 │ 25Q4 │ 26Q1 │ 전체
시장 배당       │ ...
Spearman(추세)  │ ...
챔피언(id=5)    │ ...
후보(재학습)    │ ...
Logistic top3   │ ...
GBDT top3       │ ...
PL              │ ...

=== 시장 대비 (전체 누적) ===
챔피언 연승 − 시장 연승 = ±x.x%p
[불일치] 챔피언≠인기1위: n건 — 챔피언픽 vs 인기픽 연승
[순위별] 1·2·3순위 픽 연승 (모델 vs 시장)
[묶음] 상위3 교집합 (모델 vs 시장)
```

---

## 8. 단계별 구현 (TDD)

| # | Task | 검증 |
|---|---|---|
| 1 | `src/engine/eval/` 분리 — 기존 benchmark 함수 이동, 동작 동일 | `npm run benchmark` 출력 회귀 없음 |
| 2 | `rolling.ts` — 고정 분할 → 확장 윈도우 루프 | 분기별 표 출력, look-ahead 누수 테스트 |
| 3 | `market.ts` — walkforward 시장 진단 이식 | 불일치·순위별·묶음 단위 테스트 |
| 4 | `model_versions` 스키마 확장 + 로컬 미러 반영 | 마이그레이션 적용, 하위호환 확인 |
| 5 | `champion.ts` — 타입별 채점 dispatch (ρ/Logistic) | id=5 로드→채점, params 빈 경우 경고 |
| 6 | `--gate-only`/`--no-gate`/`--champion` 인자 | 각 모드 동작 |
| 7 | walkforward 삭제 + 문서 갱신 | 참조 제거 확인 |

각 Task = 변경 → 테스트 → 타입체크(`npm run build`) → 커밋.

---

## 9. 리스크 / 미결

1. **id=5 params 부재** — 현 라이브 Logistic 계수가 `model_versions`에 없을 수 있음. 있으면 채점, 없으면 다음 학습 시 채워질 때까지 ρ 챔피언만. (점진 이행, 차단 아님)
2. **롤링 재학습 시간** — 분기 × 9모델 fit. 느리면 챔피언/후보+시장만 롤링, 9모델 풀비교는 고정 분할 유지(하이브리드) 고려.
3. **실행 순서** — Supabase 쓰기는 6/23 이후. 그 전까지 코드·로컬 미러 스키마만 준비.

---

## 10. 결정 사항 (2026-06-14 확정)

- [x] **9개 모델 전부 롤링.** 코드 한 루프로 단순, 모델별 분기 안정성도 확보. 실측 후 너무 느리면(>5분) 핵심 3개만 롤링하는 하이브리드로 후퇴 (리스크 2).
- [x] **`model_versions` 스키마는 지금 준비, 적용은 6/23 이후.** 마이그레이션 SQL + 로컬 미러 스키마(`model_type`/`feature_schema`/`params`)만 작성해두고, Supabase 쓰기·id=5 params 채우기는 6/23 egress 리셋 후 다음 학습 사이클에. 그 전까지 id=5 params 비면 §9대로 ρ 챔피언만 비교.
