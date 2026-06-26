# ⑱ 수득상금

**18개 항목 중 비중 (PRD 초기):** 8.77점
**최신 학습 ρ:** **+0.239** (3번째로 강한 신호, 학습 가중치 11.43)
**상태:** ✅ 신규 도입 (2026-05-25)

---

## 🎯 정의 / 의도

**"통산 수득상금 = KRA 가 인정한 검증된 실력"**

KRA 상금 시스템은 강한 말에게 더 많은 상금을 분배함.
→ 누적 수득상금이 클수록 그 말은 이미 실력으로 검증된 강자.
→ `race_entries.erng_sump` 필드로 정량 측정 가능 (출주표 sync 시 채워짐).

---

## ✅ 현재 구현 (코드)

**파일:** [src/engine/scoreItems/18_earnings.ts](src/engine/scoreItems/18_earnings.ts)

5단계 구간 매핑:

| 통산 수득상금 | 점수 | 해석 |
|---|---|---|
| `undefined` (race_entries 사전 컬럼 비어있음) | 0.5 | 중립 (정보 없음) |
| 0원 | 0.0 | 미입상 |
| 100만 미만 | 0.1 | 입문 |
| 1000만 미만 | 0.25 | 중수 |
| 1억 미만 | 0.6 | 상수 |
| 5억 미만 | 0.85 | 강자 |
| 5억 이상 | 1.0 | 최상위 |

**데이터 출처:** `race_entries.erng_sump` (사전 정보, 출주표 발표 시 KRA 가 제공, raceCardSync 가 채움).

**입력 흐름:**
1. `scorePredictor.predictRace()` 가 race_entries SELECT 시 erng_sump 같이 가져옴
2. `ScoreEngineInput.erngSump` 로 전달
3. `calculateEarningsScore()` 호출

---

## 📊 검증 결과

`scripts/check_earnings_correlation.ts` 측정 (2026-05-25):

| 구간 | 카운트 | 단승 적중률 |
|---|---|---|
| 미입상 / 중수 | 58 | **0.0%** |
| 상수 (1000만~1억) | 1,138 | **18.6%** |
| 최상위 (1억+) | 1,476 | **32.6%** |

→ **1억+ 말은 평균(26.4%) 대비 +6.2%p 우위**, 1000만~1억 대비 거의 2배.
→ 매우 강력한 시그널이며, 학습이 자동으로 11.43 가중치 부여 (PRD 초기 8.77 ↑).

---

## 📈 도입 효과

| 시나리오 | 단승 적중률 | 비고 |
|---|---|---|
| ⑱ 도입 전 + 학습 (blend 0.5) | 26.2% | |
| **⑱ 도입 후 + 학습 (blend 0.5)** | **28.3%** | +2.1%p, 누적 효과 |

상세: [modeling-history §1](../history/modeling-history.md#1-점수-학습-방식의-변천) (구 results_log 흡수)

---

## ⚠️ 알려진 한계 / 향후 개선

### 1. 6개월/1년 상금 미사용

race_entries 에는 통산뿐 아니라:
- `erng_loy`: 최근 1년 상금
- `erng_lsm`: 최근 6개월 상금

이 두 필드는 **컨디션** 신호 (최근 잘 벌고 있는지) 인데, 현재 알고리즘은 `erng_sump` (통산) 만 사용.

→ 향후 별도 sub-항목 또는 가중 평균 (예: `0.5 × 통산 + 0.5 × 1년`).

### 2. 출주표 백필 안 된 경주는 중립값 (0.5)

raceCardSync 백필이 77% (2,994/4,302 horses) 라 나머지 23% race_entries row 의 erng_sump 가 null → 점수 0.5 받음.
→ KRA 일일 한도 회복하면 자동 채워짐.

### 3. 5억+ 상한 임의 설정

5억 이상은 모두 1.0 점. 진짜 최상위 (50억+) 와 5억 의 차이 무시. 데이터로 봤을 때 차이가 작아 의도된 simplification.

### 4. 신마(데뷔 직후) 차별 없음

데뷔 1-2경기 말은 erng_sump=0 → 0점. 미입상 말과 동일 점수. 실제로는 신마가 "잠재적 강자" 일 수도 있는데 반영 못 함.

→ 데뷔 경기 수 (`sump_rcod_sum`) 함께 고려하면 정교화 가능.

---

## 🔗 의존성

- KRA API: **API314** (서울) / **API316** (부산경남) — 출주표 endpoint
- DB: `race_entries.erng_sump`
- Score Engine: `src/engine/index.ts` ScoreEngineInput.erngSump
- 사전 sync: `src/sync/raceCardSync.ts` → race_entries.erng_sump 채움
- 예측: `src/engine/scorePredictor.ts` race_entries SELECT 시 동시 조회

---

## 📚 변경 이력

| 일자 | 변경 | Commit |
|---|---|---|
| 2026-05-25 | 신규 항목 도입. 5-tier 알고리즘 + race_cards 연결. | `febd5c3` |
| 2026-05-26 | race_cards → race_entries 통합 (스키마 단순화) | `db4bd4a` |
