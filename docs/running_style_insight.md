# 주행 성향 분류 시스템 — 도메인 인사이트 + 구현 결정

> 2026-05-27 세션 — ChatGPT 도메인 자문 + 우리 데이터(3,551마) 검증 결과 정리
> 새 세션은 이 문서를 먼저 읽으면 의사결정 근거를 알 수 있음

---

## 🎯 한 줄 요약

KRA 경마 출전마를 **한국 표준 5분류(도주·선행·선입·추입·자유마)**로 분류하고, 그 분류를 **18 항목 점수 알고리즘에 반영**한다. position_ratio(출전두수 정규화)와 STDDEV(스타일 안정성), front_run_success_rate(선행 유지율) 세 지표가 핵심.

---

## 📖 한국 경마 표준 5분류 (도메인)

| 분류 | 영문 | 의미 |
|---|---|---|
| **도주마** (逃) | Front Runner | 초반부터 단독 선두 |
| **선행마** | Pace Maker | 선두권 유지 |
| **선입마** (差) | Stalker/Chaser | 중위권 → 막판 추격 |
| **추입마** (追) | Closer | 최후방 → 후반 폭발 |
| **자유마** | Freestyle | 패턴 없음 (안정성 낮음) |

출처: 나무위키 경주마/경마, 부산일보·스포츠경향 경마 칼럼 등 (2026-05-27 조사).

---

## 🧠 ChatGPT 도메인 자문 핵심 인사이트

1. **position_ratio = (rank-1)/(field_size-1)** — 출전두수 다른 경주를 공평 비교 (5마 1등 vs 14마 1등을 같게 처리하면 안 됨)
2. **z-score 시간 vs ratio 순위 — 순위가 더 안정적**: 시간은 날씨·주로 노이즈 큼
3. **임계값**: `0~0.15 도주 / 0.15~0.35 선행 / 0.35~0.65 선입 / 0.65~1.0 추입`
4. **early_ratio_std**: 자유마 판정 (안정성 낮은 말)
5. **거리별 성향 다를 수 있음**: "단거리 도주, 장거리 선입" — 우리 데이터에서 사실로 입증 (max-min 차이 median 0.38)
6. **front_run_success_rate**: 출발 좋아도 결승까지 못 가는 말 분리 — 매우 강력한 신호

---

## 📊 우리 데이터 검증 (3,551마)

### 임계값 적용 시 분류 비율 (자유마 우선)

| 분류 | 임계값 | 마릿수 | 비율 |
|---|---|---|---|
| 자유마 | `stddev_position_ratio ≥ 0.35` | 362 | **10.2%** |
| 도주마 | `avg_position_ratio ≤ 0.15` | 194 | **5.5%** |
| 선행마 | `0.15 ~ 0.35` | 760 | **21.4%** |
| 선입마 | `0.35 ~ 0.65` | 1,355 | **38.2%** |
| 추입마 | `0.65 ~ 1.0` | 880 | **24.8%** |

### 한국 경마 패턴 발견

- **선행 유지율**: 49.7% (출발 상위 30% → 결승 상위 30%)
- **추입 성공률**: 21.9% (출발 하위 35% → 결승 상위 30%)
- → **선행이 추입보다 2.3배 유리**. 18 항목 ⑤가 위치 변화만 봤는데 이 사실 반영 안 됐었음 → Step 2에서 multiplier로 보강

### 거리별 성향 변동

- 단·중·장 거리 모두 뛴 말 23마(0.6%)
- 그 말들의 거리별 ratio max-min 차이: median **0.381**, p90 **0.619**
- → 한 말이 거리별로 한 분류군 이상 이동. **거리별 분류 view 필요**.

---

## 🗃 DB 변경 (마이그레이션 008)

### `horse_sectional_ability` view 확장
```sql
+ avg_position_ratio        -- 출전두수 정규화 출발 위치
+ stddev_position_ratio     -- 스타일 안정성 (자유마 판정)
+ front_run_success_rate    -- 출발 상위 30% → 결승 상위 30% 비율
```

### `horse_running_style_by_distance` view 신규
거리 카테고리별(short < 1400m / middle 1400-1800m / long > 1800m) 마별 row.
HAVING ≥ 2경주 (거리별이라 기준 완화).

---

## 🎨 UI (Phase 2·3, 커밋 90b5223)

- [client/src/lib/runningStyle.ts](../client/src/lib/runningStyle.ts) — `classifyRunningStyle()` + STYLE_INFO
- RaceEntries 본 행: 마명 옆 5분류 배지 (🏁⚡🎯💨🎲)
- 펼침 영역 ③ 카드: 분류 + ratio% + 안정성 + 선행 성공률 + 구간 시간
- 펼침 영역 거리별 카드: 단·중·장 ratio·분류 표시

---

## 🔢 평가 요소 반영 — 옵션 C (18 → 19 항목)

사용자 결정: **⑤⑥⑫ 보강 + ⑲ 신규**

### Step 2 — ⑤ 후반 구간 순위 확장 ✅ 완료 (커밋 d7d5f2a)

```ts
// 새 input
positions: Array<{ startOrd, finishOrd, fieldSize, g1fOrd? }>
frontRunSuccessRate?: number

// 새 산식
position_ratio = (ord-1) / (fieldSize-1)
finishScore = 1 - finishRatio
gainScore = 3시점 가능 시 midGain×0.6 + lateGain×0.4
          | 2시점만 가능 시 clamp((startR-finishR)×0.5+0.5)
score = finishScore × 0.6 + gainScore × 0.4

// 선행 후보(startRatio ≤ 0.3)에만 multiplier
multiplier = 0.7 + frontRunSuccessRate × 0.6  // 0.7 ~ 1.3
```

**Step 2 backfill 후 검증 결과 (3,585경주 / 38,506 prediction):**

| 항목 | Step 1 mean | Step 1 stddev | Step 2 mean | Step 2 stddev |
|---|---|---|---|---|
| ④ | 0.461 | 0.230 | 0.461 | 0.230 (변화 없음) |
| ⑤ | 0.310 | 0.223 | **0.524** | **0.170** |

**주행 성향별 ⑤ 평균** (의미 있는 변별력 확보 — ★ 핵심):

| 분류 | 예측 수 | mean ⑤ |
|---|---|---|
| 🏁 도주마 | 387 | **0.655** |
| ⚡ 선행마 | 1,742 | 0.552 |
| 🎲 자유마 | 575 | 0.537 |
| 🎯 선입마 | 3,212 | 0.513 |
| 💨 추입마 | 1,783 | **0.490** |

→ 도주마와 추입마 점수 격차 0.165. Step 1엔 없던 차이.

**선행 후보 말 success_rate 효과** (★★★ 매우 강력):

| success_rate | 평균 ⑤ |
|---|---|
| ≥70% | **0.768** |
| 50-70% | 0.566 |
| 30-50% | 0.423 |
| <30% | **0.312** |

→ **2.5배 차이**. multiplier ×0.7~×1.3 의도대로 작동.

**해석 — 왜 stddev 감소가 성공인가:**
- Step 1 stddev 0.223 = 의미 있는 변별력 + **무작위 노이즈**
- Step 2 stddev 0.170 = 의미 있는 변별력만 (노이즈 제거됨)
- 분류·success_rate 같은 도메인 신호가 점수에 흡수됨 → 적중률 개선 직결
- mean 상승은 산식 자체 변화일 뿐, 가중치 학습이 자동 조정

### Step 다음 — ⑥ 거리 적성 (계획) ★ 1순위

**현재 ⑥:** 같은 거리 과거 경주 평균 순위만 봄. 5마 1등 vs 14마 1등을 같게 처리.

**개선:** `horse_running_style_by_distance`에서 이번 경주 거리 카테고리(short/middle/long)의 `avg_finish_ratio`를 가져와 `점수 = 1 - finish_ratio`. 거리별 데이터 있으면 그것 우선, 없으면 통합 fallback.

**효과:**
- 거리별 성향 다른 말 구분 (단거리 도주 / 장거리 추입)
- 출전두수 정규화 효과
- view 이미 존재 — 구현만 하면 됨

### Step 다음 — ⑫ 출발번호 (계획) — 2순위 (가벼움)

성향별 출발번호 영향 multiplier 차등:
- 도주마: ×1.5 (안쪽 매우 중요)
- 추입마: ×0.5 (영향 작음)
- 선행·선입·자유: ×1.0 (그대로)

**효과:** 도메인 정합성↑. 작은 변화.

### Step 다음 — ⑲ 주행 성향 매칭 (신규) — 3순위 (가장 강력하지만 비쌈)

**아이디어:** 이번 경주 페이스 × 그 말 성향 정합도. 다른 항목은 못 잡는 **경주 전체 정보**.

**산식 (간단 버전):**
1. 출전마 5분류 후 페이스 예측
2. 도주+선행 ≥ 40% → "fast", 추입 ≥ 40% → "slow", 그 외 "balanced"
3. 정합 점수: fast+추입 0.85 / fast+도주 0.30 / slow+도주 0.80 등

**비용:** 18→19 항목, ITEM_WEIGHTS 100점 재정규화, 가중치 학습 재실행.
**효과:** 한국 경마 도메인의 **가장 큰 미반영 신호**. 적중률 개선 효과 가장 클 가능성.

---

## 🎯 시니어 추천 순서

| 작업 | 비용 | 효과 | 권장 |
|---|---|---|---|
| **A. ⑥ 거리 적성** | 중 | 큼 | ⭐ **1순위** |
| **B. ⑫ 출발번호** | 작음 | 중 | 2순위 |
| **C. ⑲ 신규** | 큼 | 매우 큼 | 3순위 (A·B 정착 후) |

이유:
- A부터 시작: 안전·확실. view 준비됨. Step 2처럼 단계별 검증 사이클 적용 가능.
- C(⑲)는 가중치 재정규화·학습 재실행 비용 큼. A·B 효과 측정 후 가장 큰 변화에 베팅.
- 각 작업마다: 알고리즘 변경 → 테스트 → 커밋 → backfill → SQL 검증 → 다음.

---

## 📐 기술 결정 근거

| 결정 | 근거 |
|---|---|
| 5분류 (자유마 포함) | 한국 경마 표준 + 데이터 분포(자유마 10.2%) 자연스러움 |
| 자유마 임계값 STDDEV 0.35 | p90 부근, 10% 비율 |
| ratio 임계값 (0.15/0.35/0.65) | ChatGPT 권장 + 우리 데이터 검증 (5.5/21.4/38.2/24.8%) |
| 분류는 코드에서 (DB가 아닌) | 임계값 튜닝 유연. view는 raw 지표만. |
| 옵션 C (보강+신규) | 옵션 B(보강만)는 효과 약함, D(UI만)는 점수 미반영 — C가 균형 |
| 거리별 view 별도 (통합 안 함) | 한 말이 거리별 row 갖도록 — 단·중·장 같이 표시 가능 |

---

## 🔗 관련 파일

### 알고리즘
- [src/engine/scoreItems/05_late_position.ts](../src/engine/scoreItems/05_late_position.ts) — 확장된 ⑤
- [src/engine/scorePredictor.ts](../src/engine/scorePredictor.ts) — fieldSize·g1fOrd 채움

### DB
- [supabase/migrations/008_running_style_metrics.sql](../supabase/migrations/008_running_style_metrics.sql)

### UI
- [client/src/lib/runningStyle.ts](../client/src/lib/runningStyle.ts)
- [client/src/pages/RaceEntries.tsx](../client/src/pages/RaceEntries.tsx) — 본 행 + 펼침 + 거리별

### probe (일회성, T-007 정리 대기)
- [scripts/probe_running_style.ts](../scripts/probe_running_style.ts) — 분포 조사
- [scripts/apply_migration_008.ts](../scripts/apply_migration_008.ts) — 008 적용 + 검증

---

## ⏭ 다음 작업 (당시 계획 기록 — 史料)

> ✅ **2026-05-28 이후 업데이트:** 아래 ⑤⑥⑫⑲ 모두 **완료**됐습니다. ⑲는 구현됐으나 실측 ρ=-0.010으로 weight=0 (스코어맵 재설계만 대기 — [project_running_style_pace_map] 참조). probe 스크립트 정리(T-007)도 완료. 이 섹션은 당시 진행 계획을 남긴 사료이며, 현재 상태는 [TODO.md](../TODO.md)·[score_roadmap.md](score_roadmap.md)가 SSOT.

**당시(2026-05-27) 위치:** Step 2 검증 완료. 옵션 C 평가 요소 반영 계획에서 ⑤ 끝남. 다음은 ⑥부터.

1. **⑥ 거리 적성 확장** (1순위) — `horse_running_style_by_distance` 활용 → ✅ 완료
2. **⑫ 출발번호 보강** (2순위) — 성향별 multiplier 차등 → ✅ 완료
3. **⑲ 신규 항목** (3순위) — 경주 페이스 vs 말 성향 매칭 → ✅ 구현 완료 (weight=0, 스코어맵 재설계 대기)
4. **probe 스크립트 정리** (T-007) → ✅ 완료

각 작업의 사이클: 알고리즘 변경 → 테스트 → 커밋·푸쉬 → 사용자 `npm run backfill` → 검증 SQL → 다음.

협업 모드·작업 분위기 인계: [docs/working_style.md](working_style.md)
