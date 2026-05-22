# ③ 거리 적성

**14개 항목 중 비중:** 10점
**상태:** ⏳ 의논 대기 (다음 세션)
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

```
rcDist: 경주 거리 (m)
ord: 착순
```

## 🎯 정의

"이 말이 오늘 거리에서 얼마나 잘 뛸 수 있는가"

## 🧮 PRD v4.0 기본 알고리즘 (의논 필요)

```javascript
function calculateDistanceFitnessScore(horseHistory, today) {
  const sameDist = horseHistory.filter(r => r.rcDist === today.rcDist);
  if (sameDist.length === 0) return 0.5; // 이력 없음
  
  const top3Count = sameDist.filter(r => r.ord <= 3).length;
  return top3Count / sameDist.length;
}
```

## ⏳ 결정 필요 사항 (다음 세션)

```
Q1. 거리 매칭 기준
   A. 정확히 같은 거리만 (1300m = 1300m)
   B. 비슷한 거리 (±100m, ±200m)
   C. 거리 구간별 (단/중/장거리)

Q2. 점수 계산 방식
   A. 3위 이내 비율 (PRD v4.0)
   B. 착순 가중 평균 (신호 2와 동일 알고리즘)
   C. 단순 평균 착순

Q3. 데이터 부족 시
   A. 중립값 0.5
   B. 비슷한 거리로 추정
   C. 0점 처리
```

## 🔗 의존성

- KRA API: API214_1 (`rcDist`, `ord`)
- DB: `horse_results.rc_dist`, `horse_results.ord`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 골격 작성, 세부 의논 대기 |
