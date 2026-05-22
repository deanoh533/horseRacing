# 신호 2: 착순 추세

**비중:** 32% (컨디션 분석 내)
**상태:** 확정 (2026-05-22, 5년 노하우 핵심 반영)

---

## 📊 KRA API 필드

```
ord: 최종 착순 (1, 2, 3, ..., 7+)
```

## 🎯 본인 노하우 (5년 경력 인터뷰 결과)

```
핵심 발견:
  1. 1등 빈도가 가장 중요 (5위까지만 차등 점수)
  2. 6위 이하는 0점 (의미 없음)
  3. 기세(추세)는 보너스, 안정성도 보너스
  4. 최근 경주가 가장 중요 (가중치 적용)

특별 통찰:
  "1-1-1-1-1 (모두 1등) > 3-3-2-2-1 (점진 향상 1등)"
  → 평균 착순 점수가 핵심
  
  "5-4-3-2-1 (강한 향상) > 3-3-3-3-3 (안정 3등)"
  → 최근 가중치로 향상 추세 반영
```

## 🧮 알고리즘

```javascript
function calculateFormTrendScore(recent5Races) {
  if (recent5Races.length === 0) return 0.5;
  
  const ord5 = recent5Races.map(r => r.ord);
  // ord5[0] = 가장 최근, ord5[4] = 가장 과거
  
  // 1. 평균 착순 점수 (핵심 - 가중 평균)
  const ordScoreMap = {1: 100, 2: 80, 3: 60, 4: 40, 5: 20, 6: 0, 7: 0};
  const weights = [0.4, 0.25, 0.15, 0.1, 0.1]; // 최신 우선
  
  const ordScores = ord5.map(o => ordScoreMap[o] ?? 0);
  const weightedAvg = ordScores.reduce((sum, score, i) => 
    sum + score * weights[i], 0);
  
  // 2. 기세 보너스 (선형 회귀 기울기)
  // 시간순으로 reverse 후 계산 (slope < 0 = 향상)
  const reversed = [...ord5].reverse();
  const slope = calculateSlope(reversed);
  const momentum = 
    slope <= -1.0 ? 5 :
    slope <= -0.5 ? 3 :
    slope <  0    ? 1 :
    slope >= 1.0  ? -5 :
    slope >= 0.5  ? -3 : 0;
  
  // 3. 안정성 보너스 (표준편차)
  const stdev = calculateStdev(ord5);
  const stability = 
    stdev < 1.0 ? 5 :
    stdev < 1.5 ? 3 :
    stdev > 3.0 ? -3 : 0;
  
  // 종합 (0~100 → 0~1.0)
  const total = weightedAvg + momentum + stability;
  return Math.max(0, Math.min(100, total)) / 100;
}

function calculateSlope(arr) {
  const n = arr.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i + 1, y = arr[i];
    sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
  }
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

function calculateStdev(arr) {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
```

## 📊 점수 기준

### 착순별 기본 점수
| 착순 | 점수 |
|------|------|
| 1등 | 100 |
| 2등 | 80 |
| 3등 | 60 |
| 4등 | 40 |
| 5등 | 20 |
| 6등 이하 | 0 |

### 가중치 (시간 감쇠)
```
ord5[0] (가장 최근): 0.40 ⭐
ord5[1]            : 0.25
ord5[2]            : 0.15
ord5[3]            : 0.10
ord5[4] (가장 과거): 0.10
```

### 보너스
- **기세** (선형 회귀 기울기): -5 ~ +5
- **안정성** (표준편차): -3 ~ +5

## 📊 검증 시나리오

| 패턴 (과거→최근) | 가중평균 | 기세 | 안정성 | **총점** |
|-----------------|---------|------|--------|---------|
| 1-1-1-1-1 (모두 1등) | 100 | 0 | +5 | **100** ⭐⭐⭐ |
| 2-1-1-2-1 (상위 안정) | 90 | +1 | +5 | **99** |
| 1-2-1-2-1 (1-2등 안정) | 93 | 0 | +5 | **98** |
| 3-3-2-2-1 (점진 향상) | 84 | +3 | +5 | **92** |
| 5-5-1-1-1 (바닥→최근 1등) | 84 | +5 | 0 | **89** |
| 5-4-3-2-1 (강한 향상) | 75 | +5 | 0 | **83** |
| 3-3-3-3-3 (안정 3등) | 60 | 0 | +5 | **65** |
| 7-6-5-4-3 (4등 이하 향상) | 37 | +5 | 0 | **45** |
| 1-2-3-4-5 (점진 하락) | 45 | -5 | +3 | **43** |
| 7-7-7-7-7 (모두 7등) | 0 | 0 | +5 | **5** |

## ✅ 본인 의도 검증

```
✅ 1-1-1-1-1 (100) > 3-3-2-2-1 (92): 1등말 압도적
✅ 3-3-2-2-1 (92) > 5-4-3-2-1 (83): 평균 점수가 더 좋음
✅ 5-4-3-2-1 (83) > 3-3-3-3-3 (65): 향상이 안정보다 ↑
✅ 1-2-3-4-5 (43): 점진 하락 강하게 감점
```

## ⚠️ 데이터 사이언스 인사이트

```
🔬 Recency Bias 경고 자동 회피:
  단순 추세보다 "3등 이내 빈도"가 신뢰도 ↑
  
🔬 평균 회귀 (Regression to the Mean):
  안정성 보너스로 우연 1등 보정
```

## 🔗 의존성

- KRA API: API214_1 (`ord`)
- DB: `horse_results` 테이블의 `ord` 컬럼

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 본인 노하우 인터뷰 + 가중평균 알고리즘 확정 |
