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

검증: stddev 0.230 (Step 1 직후) → ? (Step 2 backfill 후 측정 예정)

### Step 다음 — ⑥ 거리 적성 (계획)

`horse_running_style_by_distance`에서 이번 경주 거리 카테고리의 `avg_finish_ratio` 활용.
거리별 데이터 있으면 그것 우선, 없으면 통합 fallback.

### Step 다음 — ⑫ 출발번호 (계획)

성향별 출발번호 영향 차등:
- 도주마: ×1.5 (안쪽 매우 중요)
- 추입마: ×0.5 (영향 작음)
- 기타: ×1.0 (현재 그대로)

### Step 다음 — ⑲ 주행 성향 매칭 (신규)

이번 경주 페이스(빠른/느린/균형) × 그 말의 성향 정합도. 18→19 항목, 가중치 재정규화.

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

## ⏭ 다음 작업 (새 세션 인계용)

1. **Step 2 검증 대기**: 사용자가 `npm run backfill` 실행 후 ⑤ stddev SQL 조회 결과 공유
2. **⑥ 거리 적성 확장**: `horse_running_style_by_distance` 활용
3. **⑫ 출발번호 보강**: 성향별 차등
4. **⑲ 신규 항목**: 경주 페이스 vs 말 성향 매칭. 가중치 재정규화 필요
5. **probe 스크립트 정리** (T-007): scripts/probe_*.ts 10개 → `scripts/probes/` 이동 또는 .gitignore
