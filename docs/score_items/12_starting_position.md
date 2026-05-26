# ⑫ 출발번호 (Starting Position)

**18개 항목 중 비중 (PRD 초기):** 2.63점
**학습 가중치 (2026-05-25):** 2.90점
**최신 학습 ρ:** **+0.061** (약한 양의 신호)
**상태:** ✅ chul_no 사용 (stOrd 는 cheating 으로 봉인 후 해제됨)
**최근 업데이트:** 2026-05-26 (PRD 동기화)

---

## 🎯 정의 / 의도 (이상)

"내곽(1번) 게이트 출발이 단거리 경주에서 유리. 거리가 길어질수록 영향 작아짐."

---

## ⚠️ KRA API "stOrd" Cheating 사례

상세: [kra_api_quirks.md](../kra_api_quirks.md#-quirk-5-critical-stord-가-결승순위와-100-동일-cheating)

### 발견 (2026-05-24)

`racedetailresult` API 의 `stOrd` 필드가 명세상 "출발 순위" 인데, 실측 결과 **모든 row 에서 `ord` (결승순위)와 100% 동일** (995/995).

```
chul_no | st_ord (KRA) | ord (결승)
1번 더선아미르 |   6  | 6
2번 온누리빛   |   2  | 2
3번 나스카불청객 |   1  | 1   ← 결승 1위
4번 프라임스타  |  11  | 11
...
```

→ stOrd 를 ⑫ 입력으로 쓰면 **정답을 미리 본 셈 (cheating)**.

### 진짜 게이트 번호 확보

출주표 API (API314 서울 / API316 부산경남) 의 `pthrNo` (출주마번호) 와 비교:

```
hr_name       | pthrNo | chul_no | ord
나스카불청객   |   3   |   3   |  1   ← 결승 1위
더선아미르     |   1   |   1   |  6
프라임스타     |   4   |   4   | 11
```

→ `pthrNo == chul_no` (마구간 번호) **이고**, `ord` 와 무관.

**결론:** 진짜 게이트 번호는 우리가 이미 갖고 있던 `chul_no` 였음. KRA 의 "stOrd" 필드명이 misleading.

---

## ✅ 현재 구현 (코드)

**파일:** [src/engine/scoreItems/12_starting_position.ts](../../src/engine/scoreItems/12_starting_position.ts)

```javascript
function calculateStartingPositionScore(stOrd, totalHorses, rcDist) {
  // 상대 위치 (1.0 = 가장 내곽, 0 = 가장 외곽)
  const relativePos = (totalHorses - stOrd) / (totalHorses - 1);

  // 거리별 가중치
  const distanceWeight =
    rcDist <= 1400 ? 1.0 :    // 단거리: 100%
    rcDist <= 1700 ? 0.5 :    // 중거리: 50%
    0.2;                       // 장거리: 20%

  // 중립값(0.5)으로 수렴
  return 0.5 + (relativePos - 0.5) * distanceWeight;
}
```

**중요:** `stOrd` 인자에 KRA 의 stOrd 가 아닌 **`chul_no` 가 전달됨**.

[src/engine/scorePredictor.ts](../../src/engine/scorePredictor.ts):
```typescript
// ⑫ 출발번호: KRA st_ord는 결승순위(cheating)였음. 진짜 게이트는 chul_no
stOrd: h.chul_no,
```

### 거리별 영향력

| 거리 구간 | 영향력 | 1번 vs 10번 점수 차이 |
|---|---|---|
| ≤ 1400m (단거리) | 100% | 1.0 vs 0.0 (큼) |
| 1400-1700m (중거리) | 50% | 0.75 vs 0.25 |
| ≥ 1800m (장거리) | 20% | 0.6 vs 0.4 (작음) |

---

## 📊 측정 결과

| 시점 | 알고리즘 | ρ |
|---|---|---|
| cheating | stOrd (= 결승순위) | **+0.83** (가짜) |
| 정직 | chul_no (= 게이트 번호) | **+0.061** (진짜 신호) |

→ 진짜 게이트 번호의 영향력은 실제로 작음 (ρ 0.06). 도메인 상식과 일치 (가장 큰 변수는 말 자체의 실력).

---

## ⚠️ 알려진 한계 / 향후 개선

### 1. chul_no = 게이트 번호 가정

KRA 실무에서 일반적으로 마구간 번호(chul_no = race_entries.pthr_no) 순서대로 게이트 배정되지만, 일부 경주에서 별도 추첨할 수도 있음. 진짜 게이트 추첨 결과는 출주표에 명시되어 있지만 출주표 pthrNo 와 마구간 번호가 동일한 의미라 따로 구분 안 함.

→ 만약 KRA 가 별도 게이트 번호 endpoint 를 풀면 보강 가능.

### 2. 거리별 가중치 휴리스틱

100% / 50% / 20% 는 도메인 상식 기반 휴리스틱. 학습으로 조정 가능하지만 ρ 자체가 작아 (+0.06) 큰 영향 없음.

---

## 🔗 의존성

- DB: `race_entries.pthr_no` (= 구 horse_results.chul_no = race_cards.pthr_no). 사전/사후 모두 동일 컬럼

---

## 📚 변경 이력

| 일자 | 변경 | Commit |
|---|---|---|
| 2026-05-26 | PRD 동기화 (cheating 사례 + 측정 ρ 추가) | (문서만) |
| 2026-05-24 | stOrd 봉인 해제 → **chul_no** 로 변경 | `060aac7` |
| 2026-05-24 | stOrd cheating 발견 후 항목 봉인 (학습 가중치 0) | `d6d80a1` |
| 2026-05-22 | KRA API 검증 (stOrd ≠ chul_no 사례 5/17 부산 1R) | - |
| 2026-04 | PRD v2.3 정의 | - |
