# ④ 주로 적응

**14개 항목 중 비중:** 10점
**상태:** ⏳ 의논 대기
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

```
track: 주로 상태 (예: "건조 (2%)", "다소불량", "불량")
ord: 착순
```

## 🎯 정의

"이 주로 상태에서 평소보다 얼마나 강한가" (향상도 기반)

## 🧮 PRD v4.0 알고리즘

```javascript
function calculateTrackAdaptationScore(horseHistory, today) {
  const todayTrackType = extractTrackType(today.track);
  const sameTrack = horseHistory.filter(r => 
    extractTrackType(r.track) === todayTrackType);
  
  if (sameTrack.length === 0) return 0.5;
  
  // 향상도 = 전체 평균 착순 - 해당 주로 평균 착순
  const overallAvgOrd = avg(horseHistory.map(r => r.ord));
  const sameTrackAvgOrd = avg(sameTrack.map(r => r.ord));
  const improvement = overallAvgOrd - sameTrackAvgOrd; // 양수 = 향상
  
  // PRD 변환
  if (improvement >= 2.0) return 1.0;
  if (improvement >= 1.0) return 0.75;
  if (improvement >= 0) return 0.5;
  if (improvement >= -1.0) return 0.25;
  return 0.0;
}
```

## ⏳ 결정 필요 사항 (다음 세션)

```
Q1. 주로 상태 매칭 기준 (신호 3에서 결정됨: 종류만 매칭)
   → "건조 (2%)" = "건조" 처리

Q2. 데이터 부족 시 (최소 몇 경주 필요?)
   - 2경주 미만이면 신뢰도 ↓?

Q3. 다른 주로 상태와 비교 가중치?
```

## 🔗 의존성

- KRA API: API214_1 (`track`, `ord`)
- DB: `horse_results.track`, `horse_results.ord`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 골격 작성 |
