# 게이트 보조면 채택 실험 — 설계

> 2026-06-15. 브랜치 `feat/duckdb-local-mirror`.
> 선행: [게이트 3면화](2026-06-15-gate-multimetric-design.md) — 게이트B가 연승·fade·복승 3지표를 같이 측정(진단).

---

## 1. 한 줄 목표

연승 자로는 약해도 **fade/복승 자로 센 재료(ScoreItem)** 를 롤링 학습 모델의 피처 집합에 편입해, **현 챔피언보다 나은 후보 모델**이 나오는지 검증한다. 양성이면 채택을 검토하고, 음성이면 현상유지하되 결과를 기록한다.

## 2. 배경·문제

- 게이트B(`src/engine/eval/gates.ts`)의 채택 규칙은 **단일 자**다: `include = placeDelta > 0` (연승 적중률 — 모델 1순위 말이 3착 내에 드는가).
- 채택된 항목 집합(`approved`)은 단순 리포트가 아니라 **실제 피처 선택을 구동**한다 (`scripts/benchmark_all.ts:47` → `trainAllModels(block.train, approved)`). 즉 롤링 학습 모델(Spearman / Logistic / GBDT / PL)이 학습할 ScoreItem을 결정한다.
- 게이트 3면화로 드러난 사실: 연승 delta는 약한데 fade/복승 delta는 강한 항목이 있다.
  - ②마체중변화: 연승 +1.8 / fade +3.2 / 복승 +1.6
  - ⑬나이×거리×성: 연승 +0.5 / fade +3.4
- 가설: 이런 항목은 연승 단일 자가 못 잡는 **직교 정보**를 담고 있을 수 있고, 편입 시 더 나은 후보 모델이 나올 수 있다.

## 3. 핵심 구조 사실 (목표 해석에 직접 영향)

`approved` 집합은 **챔피언 모델을 바꾸지 않는다**. `benchmark_all.ts`에서 챔피언(`model_versions`, 현 id=6)은 `loadVersion`으로 **고정 스키마째 로드**되며 `approved`와 무관하다. `approved`가 구동하는 것은 매 블록 새로 학습되는 **롤링 후보 모델(Spearman / Logistic / GBDT / PL)** 의 피처 집합뿐이다.

→ 따라서 이 실험이 직접 묻는 것은 "헤드라인(챔피언) 숫자를 미는가"가 **아니라**, **"보조면 항목을 편입한 롤링 후보 모델이 현 챔피언의 연승/시장격차를 넘는가"** 이다. 넘으면 그 후보가 새 챔피언 후보가 된다. 목표("연승 천장 돌파 보조")와 정합한다.

## 4. 게이트B 게이트 흐름 (현행, 변경 안 함)

`runGateB`는 항목별 ablation으로 3지표 delta를 낸다(`delta = base - without`, 양수 = 항목이 도움). 학습=`raceDate < 20251001`, holdout=Q4 2025. 이 산식·holdout·include 기본 로직은 **이번 실험에서 변경하지 않는다.**

## 5. 접근 — 비침습 실험 스위치

기존 검문소 코드(`include = placeDelta > 0`)와 기본 동작을 **불변**으로 두고, benchmark에 실험용 플래그를 단다.

- 플래그 **없으면**: 지금과 100% 동일 (`approved = include=true 항목`).
- 플래그 **있으면**: 보조면 자격을 추가로 통과한 항목을 `approved`에 **합집합**으로 더한다.

이미 챔피언 로드 경로·`collect.ts`·게이트A는 무변경. 스위치를 끄면 완전 원복.

(기각한 대안: ① runGateB include 로직을 즉시 union/composite로 영구 변경 — 증명 전 기본 동작을 바꿔 "양성일 때만 채택" 목표·verification 원칙과 충돌. ② 별도 실험 스크립트 — 롤링 로직 중복.)

## 6. 4단계 프로토콜

### Phase 0 — 분포 확인 (컷오프를 데이터로 결정)
- 실행: `npm run benchmark -- --gate-only` (사용자 실행 → Claude 판독).
- 산출: 전 항목의 연승·fade·복승 delta 표.
- 식별: **place delta ≤ 0(현재 탈락)인데 fade 또는 복승 delta가 뚜렷이 양수**인 후보군.
- 결정: 분포 모양을 보고 보조면 자격 컷오프를 **데이터로** 정한다 (직관 단독 금지 — CLAUDE.md). 예: `fadeDelta ≥ τ_f` 또는 `quinDelta ≥ τ_q`, τ는 분포에서.

### Phase 1 — 실험 스위치 구현 (TDD)
- `--gate-aux` 플래그를 `scripts/benchmark_all.ts`에 추가. 기본 off.
- **보조면 자격 판정을 순수 함수로 분리**(예: `auxQualified(result: GateBResult, cfg): boolean`)하여 단위 테스트. `GateBResult`는 이미 `fadeDelta`/`quinDelta`를 들고 있으므로 게이트 재실행 불필요.
- on일 때: `approved = (include=true 항목) ∪ (auxQualified 항목)`.
- 기존 테스트 회귀 없음 + 신규 순수 함수 테스트 통과.

### Phase 2 — A/B 비교
- baseline: `npm run benchmark`
- treatment: `npm run benchmark -- --gate-aux`
- (사용자 실행 → Claude 판독.) 롤링 모델들의 **연승/단승/시장격차를 분기별로** 비교. 특히 학습 모델(Logistic/GBDT/PL) 중 **챔피언의 연승·시장격차를 넘는 후보**가 나오는지.

### Phase 3 — 판정·기록
- 개선이 **노이즈 밴드를 넘으면**(baseline 분기 편차 기준) → 보조면 항목 정식 채택 / 새 챔피언 후보 승격 검토.
- 넘지 못하면 → place-only 유지, 3면화는 진단으로 존속.
- **어느 쪽이든** 기록: `docs/score_roadmap.md`(항목 판정), 메모리 `project_feature_gate_findings`·`project_gate_multimetric` 갱신. 양성이면 `docs/accuracy_metrics.md` 검증법 추가.

## 7. 성공 기준 (노이즈 밴드)

롤링은 분기가 여럿이라 단일 분기 우연을 배제해야 한다. 기준 = "**전체(overall) 연승 또는 시장격차가 baseline 대비 일관되게 개선**(분기 다수에서 같은 방향)". 정확한 컷은 Phase 0 분포 + baseline 분기 편차를 보고 Phase 2 직전 확정한다.

## 8. 미정 (의도적 — 데이터로 결정)

- 보조면 자격 컷오프 τ_f / τ_q → Phase 0 분포에서.
- "개선했다"의 노이즈 밴드 → baseline 분기 편차에서.

## 9. 무변경 보장 (회귀 방지)

- `runGateB`의 `include = placeDelta > 0` 기본 로직 불변.
- 챔피언 로드 경로(`loadVersion`) 불변.
- `collect.ts` / 게이트A 불변.
- `--gate-aux` 미지정 시 `approved` 산출 결과 비트 단위 동일.

## 10. 파일 영향 (예상)

- **Modify** `scripts/benchmark_all.ts` — `--gate-aux` 플래그 파싱 + on일 때 `approved` 합집합.
- **Create** `src/engine/eval/gateAux.ts` — `auxQualified` 순수 함수 + 컷오프 설정 타입.
- **Create** `src/engine/eval/gateAux.test.ts` — 순수 함수 단위 테스트.

> 실제 컷오프 상수·플래그 인자 형태는 Phase 0 판독 후 구현 계획에서 확정.
