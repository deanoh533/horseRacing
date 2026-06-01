# 🎯 점수 알고리즘 — 수정 가이드

> 종합점수가 만들어지는 **흐름**과 **알고리즘을 수정하는 방법**을 정리합니다.
> 항목 목록·비중·ρ·상태와 항목별 산식은 **중복 방지를 위해 여기에 두지 않고** 아래 SSOT로 위임합니다.
>
> | 알고 싶은 것 | 단일 출처(SSOT) |
> |---|---|
> | 21개 항목 목록·비중·Spearman ρ·상태 | [score_roadmap.md §1 마스터 상태표](score_roadmap.md) |
> | 항목별 상세 산식 | `docs/score_items/NN_*.md` (※ 09b·10b·⑲는 개별 문서 없음 → 코드가 출처) |
> | 사전/사후 데이터 소스 차이 | [prediction_mode.md](prediction_mode.md) |

---

## 1. 종합점수가 만들어지는 흐름

```
입력 (race_entries + 과거이력)
   ↓
buildEngineInput()      ← scorePredictor.ts
   ↓
ScoreEngine.calculateScores(input)
   ↓
21개 항목 함수가 각각 raw 점수 [0, 1] 반환
   ↓
weightedScore = raw × ITEM_WEIGHTS[id]
   ↓
total = Σ weightedScore  → 0 ~ 100점
```

핵심 파일:
- 항목 ID·가중치 정의: [src/types/index.ts](../src/types/index.ts) `SCORE_ITEM_IDS` / `ITEM_WEIGHTS`
- 엔진: [src/engine/index.ts](../src/engine/index.ts)
- 입력 준비: [src/engine/scorePredictor.ts](../src/engine/scorePredictor.ts)
- 항목 알고리즘: [src/engine/scoreItems/](../src/engine/scoreItems/) `01_rating.ts` ~ `19_running_style_pace.ts` (+ `09b`, `10b`)

> 항목은 총 **21개** (01~19 + 09b·10b). 일부는 SEALED·weight=0 (실제 가중치는 학습으로 결정). 항목별 ρ·상태는 [score_roadmap.md](score_roadmap.md) 참조.

---

## 2. 알고리즘을 수정하는 절차

알고리즘은 ① 학습으로 가중치만 변경, ② 산식 자체 수정 두 가지 길이 있습니다.

### A. 가중치만 갱신 (Spearman 학습)

```
npx tsx scripts/learn_weights_once.ts        # dry-run, 미리보기
npx tsx scripts/apply_learned_weights.ts     # 적용 + 히스토리 저장
```

### B. 산식 자체 수정

수정 대상은 항상 한 파일 안에 캡슐화되어 있습니다.

```
src/engine/scoreItems/NN_xxx.ts              ← 알고리즘
src/engine/scoreItems/NN_xxx.test.ts         ← 단위 테스트
```

**수정 순서:**
1. `NN_xxx.test.ts`에 새로운 케이스 추가 (예상 점수 명시)
2. 알고리즘 수정 → 테스트 통과 확인
3. 입력값이 새로 필요하면:
   - `src/engine/index.ts`의 `ScoreEngineInput`에 필드 추가
   - `src/engine/scorePredictor.ts`의 `buildEngineInput`에서 채우기
   - 항목 함수에서 사용
4. 전체 backfill:
   ```
   npx tsx scripts/backfill_predictions.ts
   ```
5. 적중률 변화 확인:
   ```
   npx tsx scripts/accuracy_stats.ts
   ```
6. 가중치 재학습:
   ```
   npx tsx scripts/apply_learned_weights.ts
   ```

### C. 전문가 자문으로 새 산식 받았을 때

⑧⑭처럼 `EXPERT_PENDING` 표시된 항목은 산식이 임시입니다. (⑬은 T-014로 비활성화 결정)
새 산식을 받으면:

1. `src/engine/index.ts`의 `EXPERT_PENDING` Set에서 제거
2. `NN_xxx.ts` 알고리즘 교체 + 테스트 작성
3. 위 §B 4~6단계 진행

---

## 3. 가중치 봉인 (sealed)

`src/engine/weightLearner.ts`의 `SEALED_ITEMS`에 넣으면 학습 대상에서 제외(가중치 0 강제).
현재 SEALED 항목과 그 근거(ρ 값)는 [score_roadmap.md §1](score_roadmap.md) 참조.

---

## 4. 입력 데이터 가용 범위 (사전/사후)

같은 `predictRace()`가 `race_entries.ord` NULL 여부로 사전/사후 모드를 자동 분기합니다.
대부분 항목은 사전·사후 모두 가용하나, **⑰ 배당률은 과거 popularity만** 사용(당일 win_odds는 사전 모드에서 가용 불가 → 일관성 위해 사후에서도 미사용).

자세한 항목별 사전/사후 데이터 소스 차이는 → [prediction_mode.md](prediction_mode.md)
