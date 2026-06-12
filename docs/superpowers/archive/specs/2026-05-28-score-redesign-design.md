# 점수 알고리즘 재설계 스펙 (Score Redesign Design)

> 작성: 2026-05-28 | 상태: 승인됨  
> 범위: **B — 가중치 직접 매핑 + 핵심 항목 교체/추가**  
> 세션 handoff: 이 문서를 새 세션에서 읽으면 컨텍스트 복원 가능

---

## 1. 배경 및 목표

### 핵심 문제

현재 가중치와 실측 Spearman ρ가 극심하게 불일치함 (n=37,434 경주).

| 항목 | 현재 가중치 | Spearman ρ | 문제 |
|---|---|---|---|
| ① 레이팅 | 17.54 (1위) | 0.078 (13위) | 가중치 1위인데 신호 꼴찌급 |
| ⑦ 주로적응 | 8.77 | 0.032 | 가중치 높은데 신호 거의 없음 |
| ④ 구간시간 | 2.37 | 0.060 | ⑤와 같은 데이터, 1/6 신호만 |
| ⑥ 거리적성 | 8.77 | 0.586 (1위) | 압도적 신호인데 가중치 미반영 |
| ⑤ 후반순위 | 2.37 | 0.350 (2위) | 극심한 저평가 |

### 목표

1. Spearman ρ를 가중치에 직접 반영 (ρ=0.586인 ⑥이 ~38% 가중치 받도록)
2. 신호 없는 항목(⑦④) 제거
3. ① 레이팅 range restriction 해결
4. 누락된 핵심 신호(E/G 최근형, ⑲ 페이스매칭) 추가

---

## 2. 항목 구조 설계

### 제거 (SEALED → weight 0, rawScore 0.5 고정)

| 항목 | ID | ρ | 이유 |
|---|---|---|---|
| ⑦ 주로 적응 | `07_track_adaptation` | 0.032 | 가중치 8.77인데 신호 거의 없음 |
| ④ 구간 시간 | `04_sectional_time` | 0.060 | ⑤와 같은 원본, 1/6 신호. 순위>시간 증명됨 |

> 구현: `weightLearner.ts`의 `SEALED_ITEMS` 집합에 추가.  
> 코드는 삭제하지 않음 — rawScore 계산만 bypass하고 0.5 반환.

### 재설계 (T-015)

**① 레이팅 `01_rating.ts`**

| 현재 | 변경 |
|---|---|
| `rawScore = rating / maxRating` (절대값) | `rawScore = (horse.rating - raceMin) / (raceMax - raceMin)` |

- `raceMin == raceMax` 이면 `0.5` (flat, 변별력 없음)
- scorePredictor가 경주 전체 horses를 보유하므로 race-level min/max 계산 가능
- 효과: range restriction 해소. 클래스 내 레이팅 차이를 상대적으로 반영

### 신규 추가

**E. 기수 최근형 `09b_jockey_recent.ts`**

```
입력: race_entries에서 같은 기수의 최근 90일 완주 경기 이력
산식: rawScore = (90일 1등 경기 수) / (90일 완주 경기 수)
fallback: 데이터 없으면 0.5
```

- 현재 ⑨ `09_jockey_form`은 통산 성적만 봄 → 최근 Hot streak 미반영
- 새 항목 ID: `09b_jockey_recent`

**G. 조교사 최근형 `10b_trainer_recent.ts`**

```
입력: race_entries에서 같은 조교사의 최근 90일 완주 경기 이력
산식: rawScore = (90일 1~2등 경기 수) / (90일 완주 경기 수)  ← 복승률
fallback: 0.5
```

- 현재 ⑩ `10_trainer_form`은 통산만 봄
- 새 항목 ID: `10b_trainer_recent`

**D. 주행성향 × 페이스 `19_running_style_pace.ts`**

**DB 스키마 (migration 008):**
- `horse_running_style_by_distance` 뷰: `hr_name`, `dist_category`(short/middle/long), `avg_position_ratio`, `stddev_position_ratio`, `avg_finish_ratio`
- **분류 label은 뷰에 없음** — avg/stddev raw값만 저장. 분류는 코드에서.
- 기존 분류 함수: `client/src/lib/runningStyle.ts::classifyRunningStyle()` (client 전용)
- 엔진 scoreItem에서는 **동일 로직을 인라인으로 재구현** (client/src는 별도 패키지)

**분류 임계값 (우리 데이터 검증값):**
```
자유마: stddev_position_ratio >= 0.35  (우선 판정)
도주마: avg_position_ratio <= 0.15
선행마: avg_position_ratio <= 0.35
선입마: avg_position_ratio <= 0.65
추입마: 나머지
unknown: avg_position_ratio null (신마 등)
```

**STEP 1: 경주 페이스 유형 결정**
```
front_count = 경주 내 도주+선행 마릿수 (unknown 제외)
front_count >= 3 → "HOT"   (선두 경쟁 치열, 추입마 유리)
front_count == 2 → "NORMAL"
front_count <= 1 → "SLOW"  (단독 도주 가능, 도주마 유리)
```

**STEP 2: 이 말의 성향 조회**
```
horse_running_style_by_distance에서 (hr_name, dist_category) 조회
dist_category = rcDist < 1400 → 'short' / ≤ 1800 → 'middle' / > 1800 → 'long'
데이터 없거나 unknown → 중립(0.55) 반환
```

**STEP 3: 매핑 테이블**

```
         HOT    NORMAL   SLOW
도주     0.30    0.65    1.00
선행     0.50    0.70    0.85
선입     0.65    0.60    0.45
추입     0.90    0.55    0.25
자유     0.60    0.60    0.60  ← 불안정, 중립
unknown  0.55    0.55    0.55  ← fallback
```

> 초기값은 도메인 기반. 가중치 학습 후 ρ 측정으로 효과 검증하고 조정.

**scorePredictor.ts 변경:**
```ts
// predictRace() 내에서 ⑲ 계산 전 선행 처리
const styleMap = buildStyleMap(allHorses, rcDist, runningStyleData)
// → { hr_name → RunningStyle } 맵
const paceType = computePaceType(styleMap)
// → 'HOT' | 'NORMAL' | 'SLOW'

// 각 말 점수 계산 시
const score19 = calculate19(styleMap.get(horse.hrName), paceType)
```

`runningStyleData` = scorePredictor 호출 전 Supabase에서 fetch한 `horse_running_style_by_distance` 배열 (이미 ⑤⑥에서 같은 데이터 사용 중 — 중복 fetch 최소화 가능)

### 유지 항목 (로직 변경 없음, 가중치만 갱신)

⑤ ⑥ ⑧ ③ ⑱ ⑨ ⑩ ⑪ ⑫ ⑮ ⑯ ⑰ ②  
(⑥⑫은 이전 세션에서 horse_running_style_by_distance + 성향별 multiplier 구현 완료)

---

## 3. 가중치 방법론

### 방식: Spearman ρ 직접 매핑 (alpha=1.0)

```ts
// weightLearner.ts 변경
export function blendWeights(
  current: Weights,
  optimal: Weights,
  alpha = 0.5  // ← 파라미터 추가
): Weights

// apply_learned_weights.ts 호출 시
blendWeights(current, optimal, 1.0)  // 직접 수렴
```

- alpha=1.0: ρ 기반 optimal을 그대로 사용 (현재 가중치 무시)
- alpha=0.5: 기존 방식 (현재+optimal)/2 (점진 수렴용, 정기 학습 때 사용)
- 상한선 없음: ⑥가 ρ=0.586으로 ~38% 가중치 받는 것이 자연스러운 결과

### SEALED_ITEMS 추가

```ts
const SEALED_ITEMS = new Set<ScoreItemId>([
  '13_age_distance_gender',  // 기존 (ρ=-0.017)
  '07_track_adaptation',     // 추가 (ρ=0.032)
  '04_sectional_time',       // 추가 (ρ=0.060)
]);
```

### 재학습 타이밍

| 시점 | 조건 | 방식 |
|---|---|---|
| **즉시** (1단계 완료 후) | ⑦④ SEALED 적용 후 | alpha=1.0 |
| **2단계 완료 후** | ①재설계 + E/G 추가 | alpha=1.0 |
| **3단계 완료 후** | ⑲ 추가 | alpha=1.0 (최종) |
| 이후 정기 | 경주 300개 이상 누적 | alpha=0.5 (점진) |

---

## 4. 구현 구조

### 1단계 (1~2일) — 가중치 즉시 수정

**변경 파일:**

| 파일 | 변경 내용 |
|---|---|
| `src/engine/weightLearner.ts` | SEALED_ITEMS에 `07_track_adaptation`, `04_sectional_time` 추가 |
| `src/engine/weightLearner.ts` | `blendWeights()` alpha 파라미터 추가 |
| `scripts/apply_learned_weights.ts` | `--alpha 1.0` 옵션 추가 |

**검증:** `npm run apply_learned_weights -- --alpha 1.0` → weight_history 확인 → 사용자 SQL로 ρ 재측정

---

### 2단계 (1주) — 항목 재설계 + 신규 추가

**변경 파일:**

| 파일 | 변경 내용 |
|---|---|
| `src/engine/scoreItems/01_rating.ts` | min-max 정규화로 교체 |
| `src/engine/scoreItems/01_rating.test.ts` | 새 산식 테스트 |
| `src/engine/scoreItems/09b_jockey_recent.ts` | 신규 생성 |
| `src/engine/scoreItems/10b_trainer_recent.ts` | 신규 생성 |
| `src/types/index.ts` | `09b_jockey_recent`, `10b_trainer_recent` ID 등록 |
| `src/engine/scorePredictor.ts` | E/G 항목에 필요한 race_entries 데이터 연결 |

**검증:** `npm run test:run` → `npm run backfill` → SQL ρ 측정

---

### 3단계 (2~3주) — 주행성향 × 페이스

**변경 파일:**

| 파일 | 변경 내용 |
|---|---|
| `src/engine/scoreItems/19_running_style_pace.ts` | 신규 생성 (페이스 집계 + 매핑 테이블) |
| `src/types/index.ts` | `19_running_style_pace` ID 등록 |
| `src/engine/scorePredictor.ts` | allHorses 페이스 집계 선행 처리 추가 |

**선행 조건:** `horse_running_style_by_distance` 뷰 (마이그레이션 008) 존재 확인됨.

---

## 5. 세션 handoff 체크리스트

새 세션을 시작할 때 이 문서와 함께 확인:

- [ ] **1단계** — `weightLearner.ts` SEALED_ITEMS + alpha 파라미터 추가 완료?  
  → 완료 후 `scripts/apply_learned_weights.ts --alpha 1.0` 실행 + SQL ρ 검증
- [ ] **2단계** — `01_rating.ts` min-max, `09b_jockey_recent.ts`, `10b_trainer_recent.ts` 완료?  
  → 완료 후 `npm run backfill` + SQL ρ 재측정
- [ ] **3단계** — `19_running_style_pace.ts` 완료?  
  → 완료 후 `npm run backfill` + 최종 ρ 비교

---

## 6. 미결 질문

| ID | 질문 | 우선순위 |
|---|---|---|
| Q-001 | ⑤ "후반 구간" 시작점 정의 (g3f vs g1f vs 둘 다) | P2 |
| Q-002 | Spearman 학습 윈도우 (전 기간 vs 최근 1년 vs 슬라이딩) | P2 |
| Q-003 | 가중치 학습 적용 빈도 (수동 vs 주기적 vs 임계점) | P2 |
| Q-004 | E/G 최근형 — 90일 기준 vs 50경주 기준 중 어느 쪽이 더 안정적? | P1 |

---

## 7. 관련 문서

- [docs/score_roadmap.md](../score_roadmap.md) — 항목별 ρ 측정값 + 변경 이력 Living Doc
- [docs/running_style_insight.md](../running_style_insight.md) — ⑤⑥⑫ 구현 근거 + ⑲ 설계 아이디어
- [TODO.md](../../TODO.md) — T-015(레이팅), T-016(가중치) 항목
- [src/engine/weightLearner.ts](../../src/engine/weightLearner.ts) — 가중치 학습 코드
