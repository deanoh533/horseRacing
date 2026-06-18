# Platt 보정 확률 라이브 연결 — 설계

> 2026-06-19. §C8(재보정 Platt/isotonic)의 명시적 후속 트리거 — OOS에서 검증된 확률 보정을 **라이브 예측 경로에 연결**해 "정직한 확률 제품"(서비스 캘리브레이션)을 실제로 노출.
> 선행: `docs/superpowers/specs/2026-06-16-recalibration-design.md`(측정 전용, §6에서 라이브 연결을 별도 brainstorm으로 유보) / [[project_market_edge_strategy]]

---

## 0. 쉬운 말 요약 (이게 전부)

우리 모델은 경주마 **순위**(누가 1·2·3등)는 잘 맞히지만, **"몇 % 확률로 이긴다"는 숫자는 지금 아무 데도 안 만든다.** 라이브 엔진(`predictRace`)은 점수(logit)와 순위만 내고, 웹 화면에도 확률 표시가 없다.

§C8에서 확인된 사실: 모델이 확률을 말할 때 버릇이 있다 — 강한 본명은 과소(25%→실제 31%), 롱샷은 과대(1.9%→실제 1.0%). 이 비뚤어짐을 **데이터로 펴주는 작은 보정기(Platt)**를 거치면 시장만큼 정직해진다(P(1착) ECE 0.017→0.004). 지금까진 실험실(오프라인)에서만 검증했다.

**이번 작업:** 그 보정기를 **라이브에 연결**해 ① 우승확률 P(1착) ② 연승확률 P(3착내) 두 숫자를 정직하게 계산 → predictions에 저장 → 웹 예상지에 "우승확률 30% · 연승확률 62%"로 표시.

**핵심 제약(완화됨):** Supabase egress가 막혀 있었으나 조직 이전으로 **부활 완료(2026-06-19 확인, 활성 id=6)**. 따라서 6/23 마감 의존성 없음. 단 개발 중엔 egress 절약을 위해 **로컬(DuckDB) 우선 → 검증 후 Supabase push** 규율 유지.

---

## 1. 목적

§C8은 재보정 효과를 OOS로 **측정만** 했고(`npm run calib:recal`), 라이브 연결은 "OOS 개선 확인 후 별도 작업"으로 명시 유보했다. 개선이 확인됐으므로(Platt P(1착) ECE 0.004, 시장 동률) 이제 라이브 경로에 연결한다. **시장을 이기는 게 아니라 모델 자신의 확률을 정직하게** 만드는 트랙(서비스 캘리브레이션).

## 2. 확정된 설계 결정 (brainstorm)

| # | 결정 | 근거 |
|---|---|---|
| 범위 | **엔진 + DB + UI 풀.** 확률을 계산·저장·표시까지. | 사용자 결정 |
| 확률 종류 | **P(1착)(단승) + P(3착내)(연승) 둘 다.** | KRA 베팅(단·연) 정합 |
| 방법 | **Platt만**(isotonic 제외). | §C8에서 Platt≈isotonic이고 Platt이 2파라미터·소표본 안정·해석 쉬움 |
| 접근법 | **A. 아티팩트 확장** — P1 전용 모델 + Platt 2개를 활성 아티팩트에 임베드. 랭킹 모델(top3)은 불변. | §C8 검증 경로 그대로, 버전 원자성, 스키마 변경 없음, 랭킹 회귀 위험 0 |
| 저장 | 보정자는 **활성 모델의 학습행렬(`training_matrix.jsonl`)과 같은 데이터로 fit** → 아티팩트 임베드. | `recalibration_report`가 train-fit→test-apply로 OOS 일반화 입증(경미한 in-sample 낙관만 주석) |
| 재정규화 | P(1착)은 §C8과 동일하게 **경주내 정규화된 확률(normWin)에 Platt 적용**. **재정규화 여부(plain vs +재정규화)는 구현 중 `calib:recal` 실제 수치로 확정**(데이터로 결정). P(3착내)는 정규화 안 함. | §C8 승자=plain Platt 0.004이나 표에 +재정규화도 있어 실측 확인 필요 |

## 3. 배경: 현재 라이브 경로의 사실

- `predictRace`(`src/engine/scorePredictor.ts`)는 `total_score`(=top3 모델 logit)와 `predicted_rank`만 반환. **확률 없음.**
- 활성 아티팩트(`model_versions.artifact`, id=6 v6-class-move)는 **top3(3착내) 라벨로 학습된 단일 로지스틱**. `scoreLogistic`/`itemContributions`가 이 모델로 총점·항목점수 산출.
- §C8 오프라인(`recalibration_report.ts`)은 P(1착)용으로 **별도 ord==1 모델을 fold마다 학습**해 썼다. → 라이브 P(1착)에도 **전용 P1 모델이 필요**(top3 모델로는 P(1착)을 직접 못 냄).
- 학습행렬(`extract_training_matrix.ts`)은 이미 `ord`, `top3`, `top2`를 포함 → **P1 라벨(`ord===1`)은 재추출 없이 파생 가능**.
- UI는 `usePredictionsByRace`(`client/src/lib/queries.ts`) 훅으로 PredictionSheet·RaceEntries·RaceDetail·HorseDetail가 `total_score`·`predicted_rank` 소비.
- 마이그레이션 다음 번호 = **014**.

## 4. 아키텍처 (부품 1책임)

### 4.1 아티팩트 모양 (`src/engine/modelVersion.ts` 타입 확장)
기존 `LogisticModel`(top3 = 랭킹용, **불변**)에 옵션 필드 추가:
```ts
export interface Calibration {
  p1Model: LogisticModel;            // ord===1 학습, P(1착) 전용 (신규)
  platt1: { a: number; b: number };  // 경주내 정규화된 P1에 적용
  platt3: { a: number; b: number };  // top3 모델 raw 확률에 적용
  renormWin: boolean;                // p_win에 Platt 후 경주내 재정규화 여부 (구현 중 실측 확정)
  fitMeta: { rows: number; from: number; to: number; fitAt: string; baseModelId: number };
}
// 아티팩트 = LogisticModel & { calibration?: Calibration }
```
- 로더 `getActiveModelVersion`은 타입만 확장(읽는 컬럼 동일 — `artifact` JSON에 포함).
- `scoreLogistic`/`itemContributions`는 base 필드만 사용 → **랭킹·항목점수 불변**.
- `calibration` 없으면(구 아티팩트) 확률 `null` 반환(무중단 호환).

### 4.2 순수 보정 모듈 `src/engine/eval/calibratedProbs.ts` (신규, 단위테스트 대상)
```ts
// 경주 단위 입력: 한 경주 출주마들의 정렬된 feature 벡터(스키마=base 모델.features)
calibratedRaceProbs(
  artifact: LogisticModel & { calibration?: Calibration },
  vectors: number[][],   // 경주 내 모든 말, 스키마 정렬
): { pWin: (number|null)[]; pTop3: (number|null)[] }
```
- `calibration` 없으면 전부 `null`.
- `pTop3_i = applyPlatt(platt3, sigmoid(predictLogit(baseModel, v_i)))` — 정규화 안 함.
- `rawP1_i = sigmoid(predictLogit(p1Model, v_i))`; `normWin = normalizeProbs(rawP1[])`; `plattWin_i = applyPlatt(platt1, normWin_i)`; `pWin = renormWin ? normalizeProbs(plattWin[]) : plattWin`.
- `fitPlatt`/`applyPlatt`/`sigmoid`/`normalizeProbs`는 기존 `calibration.ts` 재사용.

### 4.3 보정자 학습 스크립트 `scripts/fit_live_calibration.ts` (`npm run calib:fit-live`)
1. 활성 아티팩트 M3(base 모델) 로드(기본 로컬 DuckDB; `--target supabase`로 Supabase).
2. `training_matrix.jsonl` 읽기(모델과 동일 데이터). 스키마 = `M3.features`(라이브 패리티).
3. P1 모델 M1 = `fitLogistic(X, y=ord===1, schema, cfg)` — `learn_logistic`과 동일 cfg(`{l2:0.02, iters:800, lr:0.2}`).
4. 경주(`race_date·meet·rc_no`)별 그룹화 후:
   - `rawP3_i = sigmoid(predictLogit(M3, x_i))`, 쌍 `(rawP3, top3)` → `platt3 = fitPlatt(...)`.
   - `rawP1_i = sigmoid(predictLogit(M1, x_i))`, 경주내 `normWin`, 쌍 `(normWin, ord===1)` → `platt1 = fitPlatt(...)`.
5. `renormWin`은 구현 중 `calib:recal`에서 plain vs +재정규화 ECE 비교해 우세한 쪽으로 설정.
6. 증강 아티팩트 = `{...M3, calibration}`를 **Supabase `model_versions` 활성 행에 기록**(`getSupabaseAdmin().update({artifact}).eq('id',id).select('id')` — 0행 검출). base 모델도 Supabase에서 읽어 로컬 락과 무관.
   - **⚠️ 옵션 A 확정 (2026-06-19):** 로컬 DuckDB 직접 쓰기 **폐기**. 로컬 `artifact` 컬럼은 `read_json_auto`가 STRUCT로 추론 → 새 `calibration` 필드가 JSON→STRUCT 캐스트 시 **유실**되고, 로컬 파일은 backfill에 의해 쓰기 락이 걸린다. Supabase jsonb는 임의 구조 보존 → 로컬은 **`npm run db:pull`로 갱신**(로컬=Supabase 읽기미러 설계와 일치). egress는 조직 이전으로 복구됨.

### 4.4 라이브 적용 (`predictRace`)
- 활성 아티팩트에 `calibration`이 있으면, 한 경주의 모든 말 feature 벡터를 모아 `calibratedRaceProbs` 1회 호출 → `p_win[]`, `p_top3[]`.
- `PredictionRow`에 `p_win: number|null`, `p_top3: number|null` 추가.
- `predicted_rank`·`total_score`·`item_scores` **불변**(랭킹은 기존 base 모델 총점 정렬 그대로).

### 4.5 DB (마이그레이션 014)
- `supabase/migrations/014_prediction_calibrated_probs.sql`: `ALTER TABLE predictions ADD COLUMN p_win REAL, ADD COLUMN p_top3 REAL;`(nullable).
- 로컬 DuckDB 스키마도 동일 컬럼 추가(로컬 검증용; `sync_local_db`/db:pull 경로와 정합 확인).
- `backfill_predictions`/`dailySync`는 이미 `predictRace`의 rows를 통째 insert → 신규 필드 자동 흐름. 별도 수정 불필요(필드명 일치만 확인).

### 4.6 UI
- `client/src/lib/queries.ts`: predictions 타입·select에 `p_win`, `p_top3` 추가.
- 표시(포맷 = 정수 %):
  - **PredictionSheet**(주력): 말 카드/요약에 "우승확률 30% · 연승확률 62%".
  - **RaceEntries**: 컴팩트(예: 우승% 컬럼/배지).
- `null`(구 데이터·보정 전)이면 **미표시**(graceful). RaceDetail·HorseDetail은 선택적(YAGNI — 1차는 PredictionSheet·RaceEntries만).

## 5. 데이터 흐름

```
[학습] training_matrix.jsonl (ord 포함)
   ├ base 모델 M3 (top3) = 활성 아티팩트 (불변)
   └ calib:fit-live: M1(ord==1) 학습 + platt1(normWin)·platt3(rawP3) fit
        → 아티팩트.calibration 임베드 → model_versions 기록

[라이브] predictRace
   각 경주: 출주마 feature 벡터 → calibratedRaceProbs
     p_top3 = Platt3(σ(M3))               (정규화 X)
     p_win  = Platt1(normWin(σ(M1)))       (±재정규화: renormWin)
   → PredictionRow{..., p_win, p_top3} → predictions

[UI] usePredictionsByRace → PredictionSheet/RaceEntries에 % 표시
```

## 6. 테스트 (TDD)

- `calibratedProbs` 단위:
  - `calibration` 없음 → 모든 확률 `null`.
  - Platt 적용 정확성(알려진 a·b로 기대값), 단조성.
  - 경주내 정규화: `normWin` 합≈1; `renormWin=true`면 Platt 후 합≈1.
  - 빈 경주·1마리 경주 방어.
- `fit_live_calibration` 통합: 소형 합성 매트릭스 → 아티팩트에 `calibration` 생성, platt 계수 유한, M1 학습됨.
- `predictRace` 회귀: 보정 아티팩트로 `p_win`/`p_top3` ∈ (0,1); **`predicted_rank` 순서 = 보정 전과 동일**(랭킹 불변 단언). 비보정 아티팩트로 확률 `null`.
- 기존 테스트(`calibration.test.ts` 포함) 무회귀: `npm run test:run`, `npm run build`.

## 7. 단계 (실행 순서) — 옵션 A 반영

**Phase 1 — 코드(순수·라이브·UI) 빌드 (Supabase 안 때림):**
1. 타입 확장(4.1) + `calibratedProbs.ts`(4.2) + 단위테스트.
2. `predictRace` 연결(4.4) + 회귀테스트.
3. `fit_live_calibration.ts`(4.3) — **Supabase 기록 전용**(로컬 직접쓰기 폐기). 단위테스트는 순수 `buildCalibration`만.
4. UI 컴포넌트(4.6) — 로컬/목 데이터로 표시 검증.

**Phase 2 — 검증 + 프로덕션 (Supabase 가용, db:pull로 로컬 갱신):**
5. `calib:fit-live` → Supabase 활성 artifact에 calibration 기록(랭킹 불변).
6. `npm run db:pull`(로컬 락 풀린 뒤) → 로컬 미러 갱신 → 로컬 `predictRace`로 샘플 확률 출력 → `calib:recal` ECE와 대조 → `renormWin` 확정(필요시 `--renorm` 재fit + db:pull).
7. 마이그 014 Supabase 적용 + 로컬 DuckDB 컬럼(db:pull로 반영).
8. `backfill_predictions`로 `p_win`/`p_top3` 채움(필요 범위).
9. Vercel 배포 → 웹앱 확률 표시 확인.

## 8. 범위 밖 (YAGNI)

- isotonic 라이브(Platt로 충분, §C8).
- 베팅 EV·복승/엑조틱 캘리브레이션(환급률 천장 별 트랙, [[project_benter_blend]]·[[project_market_dominance_ceiling]]에서 음성).
- RaceDetail·HorseDetail 확률 표시(1차 제외, 후속).
- 보정자 자동 재학습 스케줄(수동 `calib:fit-live`로 충분).
- rho-legacy 모델 보정(logistic 활성 전제).

## 9. 누수·정직성 노트

- 보정자를 활성 모델의 학습행렬로 in-sample fit → 약간 낙관 가능. 그러나 `recalibration_report`가 동일 구조(train-fit)를 test fold에서 ECE 0.004로 입증했으므로 라이브 일반화는 정당. 향후(데이터 누적 시) holdout fit으로 강화 가능(YAGNI 현재).
- 랭킹·`total_score`·항목점수는 base 모델 그대로 → 기존 적중률 지표·벤치마크와 **연속성 보존**.

## 10. 성공 기준

- 로컬: `calib:fit-live`가 id=6 아티팩트에 `calibration`을 임베드하고, `predictRace`가 보정된 `p_win`·`p_top3`(∈(0,1))를 반환하며 랭킹 불변. 샘플 확률이 `calib:recal` OOS 수치대와 일관.
- 프로덕션: 마이그·backfill·배포 후 웹 예상지에서 "우승확률·연승확률 %"가 표시되고, 보정 전 데이터는 graceful 미표시.
