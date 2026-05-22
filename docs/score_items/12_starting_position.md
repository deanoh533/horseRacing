# ⑨ 출발번호 (실제 출발 위치)

**14개 항목 중 비중:** 3점
**상태:** ✅ 확정 (PRD v3.0 + KRA 검증 결과)
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드 (중요!)

```
chulNo: 엔트리 번호 (출주표 순서, 단순 번호)
stOrd: 실제 출발번호 ⭐ (racedetailresult API에서만 제공)

⚠️ chulNo ≠ stOrd
   - 검증: 2026-05-17 부산 1R
     chulNo=3, stOrd=10 (10번째에서 출발!)
   
→ stOrd 사용 필수
```

## 🎯 정의

"내곽(1번) 출발이 단거리 경주에서 유리"

## 🧮 알고리즘 (PRD 그대로)

```javascript
function calculateStartingPositionScore(stOrd, totalHorses, rcDist) {
  // 상대 위치 (1.0 = 가장 내곽)
  const relativePos = (totalHorses - stOrd) / (totalHorses - 1);
  
  // 거리별 가중치 (단거리일수록 영향 큼)
  let distanceWeight;
  if (rcDist <= 1400) distanceWeight = 1.0;          // 단거리 100%
  else if (rcDist <= 1700) distanceWeight = 0.5;     // 중거리 50%
  else distanceWeight = 0.2;                          // 장거리 20%
  
  // 중립값(0.5)으로 수렴
  const neutralScore = 0.5;
  return neutralScore + (relativePos - neutralScore) * distanceWeight;
}
```

## 📊 거리별 출발번호 영향력

| 거리 구간 | 영향력 | 이유 |
|----------|--------|------|
| ≤ 1400m (단거리) | **100%** | 내곽이 절대 유리 |
| 1400-1700m (중거리) | 50% | 보통 |
| ≥ 1800m (장거리) | 20% | 거의 영향 없음 |

## 💡 검증 결과 (KRA API 호출)

```
✅ racedetailresult API에서 stOrd 정확히 추출 가능
✅ chulNo와 다를 수 있음 확인 (3 → 10 사례)
✅ 거리별 가중치는 PRD 원문 그대로 적용
```

## 🔗 의존성

- KRA API: racedetailresult/getracedetailresult (`stOrd`)
- DB: `horse_results.st_ord` (새 컬럼)

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | KRA API 검증 완료 (stOrd 정확히 추출) |
| 2026-04 | PRD v2.3 정의 |
