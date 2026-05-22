# 신호 3: 구간 시간 단축

**비중:** 18% (컨디션 분석 내)
**상태:** 확정 (2026-05-22, 옵션 C 정교 알고리즘)

---

## 📊 KRA API 필드

```
rcTime: 전체 경주 시간 (초)
buS1fAccTime: 마지막 1펄롱 시간 (스피드 마무리)
buG1fAccTime ~ buG8fAccTime: 펄롱별 누적시간 (참고용)

rcDist: 경주 거리 (m)
track: 주로 상태 (예: "건조 (2%)", "다소불량")
```

## 🎯 알고리즘 설계

```
옵션 C (선택): 정교 - 마지막 펄롱 + 전체 시간
임계값: 0.5초 이상 단축 = 만점
주로 매칭: 종류만 매칭 ("건조" = "건조", 수치 무시)
```

## 🧮 알고리즘

```javascript
function calculateSectionalTimeScore(horseHistory, today) {
  // 1단계: 같은 거리 + 같은 주로 종류 경주 필터링
  let races = horseHistory.filter(r => 
    r.rcDist === today.rcDist && 
    extractTrackType(r.track) === extractTrackType(today.track)
  );
  let confidence = 1.0;
  
  // 2단계: 데이터 부족 시 같은 거리만 (정확도 ↓)
  if (races.length < 2) {
    races = horseHistory.filter(r => r.rcDist === today.rcDist);
    confidence = 0.7;
  }
  
  if (races.length < 2) return 0.5; // 데이터 부족 → 중립
  
  // === 2가지 측면 측정 ===
  
  // (A) 전체 시간(rcTime) 단축
  const recentTotal = races[0].rcTime;
  const pastTotalAvg = avg(races.slice(1).map(r => r.rcTime));
  const totalImprove = pastTotalAvg - recentTotal;  // 양수 = 향상
  
  // (B) 마지막 펄롱(buS1fAccTime) 단축 - 스피드 마무리
  const recentLast = races[0].buS1fAccTime;
  const pastLastAvg = avg(races.slice(1).map(r => r.buS1fAccTime));
  const lastImprove = pastLastAvg - recentLast;
  
  // === 점수 변환 (0.5초 임계값) ===
  function timeToScore(imp, threshold) {
    if (imp >= threshold) return 1.0;          // 0.5+ 단축 = 만점
    if (imp >= threshold * 0.5) return 0.8;    // 0.25+ 단축
    if (imp >= 0) return 0.6;                  // 0~0.25 단축
    if (imp >= -threshold * 0.5) return 0.4;   // 0~0.25 증가
    if (imp >= -threshold) return 0.2;         // 0.25~0.5 증가
    return 0.0;                                // 0.5+ 증가
  }
  
  const totalScore = timeToScore(totalImprove, 0.5);
  const lastScore = timeToScore(lastImprove, 0.3); // 펄롱은 더 작은 임계
  
  // === 종합: 전체 60% + 마지막 펄롱 40% ===
  return (totalScore * 0.6 + lastScore * 0.4) * confidence;
}

function extractTrackType(track) {
  // "건조 (2%)" → "건조"
  return track.replace(/\s*\([^)]*\)/, '').trim();
}
```

## 📊 점수 기준표

### 시간 단축 → 점수 변환

| 단축 정도 (전체 시간) | 점수 | 단축 정도 (마지막 펄롱) |
|---------------------|------|----------------------|
| 0.5초+ | **1.0** | 0.3초+ |
| 0.25-0.5초 | **0.8** | 0.15-0.3초 |
| 0-0.25초 | **0.6** | 0-0.15초 |
| -0.25-0초 | **0.4** | -0.15-0초 |
| -0.5- -0.25초 | **0.2** | -0.3- -0.15초 |
| -0.5초 이하 | **0.0** | -0.3초 이하 |

### 신뢰도 적용
- 같은 거리 + 같은 주로 데이터: `confidence = 1.0`
- 같은 거리만 데이터: `confidence = 0.7`
- 데이터 부족 (2개 미만): `0.5` 반환

## 📊 시나리오별 점수

| 시나리오 | 전체시간 | 마지막펄롱 | **종합** |
|---------|---------|-----------|---------|
| 전체 1초 단축 + 마지막 0.5초 단축 | 1.0 | 1.0 | **1.0** ⭐ |
| 전체 0.5초 단축 + 마지막 0.3초 단축 | 1.0 | 1.0 | **1.0** |
| 전체 0.3초 단축 + 마지막 변화없음 | 0.8 | 0.6 | **0.72** |
| 전체 변화 없음 + 마지막 0.3초 단축 | 0.6 | 1.0 | **0.76** |
| 전체 0.3초 증가 + 마지막 0.3초 증가 | 0.4 | 0.2 | **0.32** |
| 같은 거리/주로 없음 → 같은 거리만 | (×0.7) | | **0.7 × x** |

## ⚠️ 엣지 케이스

```
1. buS1fAccTime이 0 또는 없음
   → 전체 시간만 사용, 비중 100%로 보정

2. rcTime이 0 또는 비정상
   → 해당 경주 제외 (데이터 오류)

3. 거리는 같지만 주로 종류 다름
   → 2단계로 자동 fallback (confidence 0.7)

4. 같은 거리 경주 전혀 없음
   → 0.5 반환 (중립)
```

## 🔬 학술적 배경

```
구간 시간(Sectional Times) 활용:
  - 말의 최고 속도 측정
  - 그 속도를 몇 펄롱 유지하는지
  - 빠른 출발 vs 느린 출발
  - 끝까지 잘 버티는지

균등 페이스가 가장 효율적:
  - 각 펄롱을 비슷한 시간에 달리는 것
  - 마지막 펄롱 = 스피드 마무리 신호
```

## 🔗 의존성

- KRA API: API214_1 (`rcTime`, `buS1fAccTime`, `rcDist`, `track`)
- DB: `horse_results` 테이블의 관련 컬럼들

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 옵션 C (정교) 선택 + 0.5초 임계 + 주로 종류 매칭 확정 |
