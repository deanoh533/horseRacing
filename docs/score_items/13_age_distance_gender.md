# ⑩ 나이 × 거리 × 성별

**18개 항목 중 비중 (PRD 초기):** 2.63점
**학습 가중치 (2026-05-25):** **0.00점** ⚠️ (ρ 음수 → 학습이 봉인)
**최신 학습 ρ:** **-0.056** (잘못된 방향)
**상태:** ⏸ 전문가 자문 대기 (PRD 임시 매트릭스가 실측과 안 맞음)
**최근 업데이트:** 2026-05-26 (PRD 동기화)

> ⚠️ PRD 의 나이-거리-성별 매트릭스가 실제 데이터와 불일치 (ρ -0.056).
> 사용자 도메인 의견 필요: 어떤 나이가 어떤 거리에 강한지 매트릭스 재설계.

---

## 📊 KRA API 필드

```
age: 나이 (정수)
sex: 성별 ("거"/"암"/"수")
rcDist: 거리
```

## 🎯 정의

"이 나이/성별 말이 이 거리에서 잘 뛰는 경향이 있는가" (인구통계적 적합도)

## ⏸ 전문가 자문 필요

```
PRD에서 임시 테이블 적용:
  - 3세 = 단거리 최강 (1.0) ~ 최장거리 최약 (0.0)
  - 6세+ = 최장거리 유리 (1.0)
  - 암말 보정: 단/중거리 ×1.1, 장/최장거리 ×0.9 (상한 1.0)

검증 필요:
  Q1. 나이-거리 스펙트럼 수치 검증
  Q2. 성별 보정 계수 (암말 유불리)
  Q3. 거리 구간별 세부 값
```

## 🧮 임시 알고리즘 (자문 후 변경)

```javascript
function calculateAgeDistanceGenderScore(age, sex, rcDist) {
  // 거리 구간
  const distCategory = 
    rcDist <= 1200 ? 'short' :
    rcDist <= 1400 ? 'medShort' :
    rcDist <= 1600 ? 'medium' :
    rcDist <= 1800 ? 'medLong' : 'long';
  
  // 나이-거리 매트릭스 (임시)
  const ageDistMatrix = {
    3: { short: 1.0, medShort: 0.8, medium: 0.6, medLong: 0.4, long: 0.0 },
    4: { short: 0.9, medShort: 0.9, medium: 0.8, medLong: 0.6, long: 0.4 },
    5: { short: 0.7, medShort: 0.8, medium: 0.9, medLong: 0.9, long: 0.7 },
    6: { short: 0.5, medShort: 0.6, medium: 0.8, medLong: 1.0, long: 1.0 },
    // 7+ = 6과 동일
  };
  
  let baseScore = ageDistMatrix[age]?.[distCategory] ?? 0.5;
  
  // 성별 보정
  if (sex === '암') {
    if (['short', 'medShort', 'medium'].includes(distCategory)) {
      baseScore = Math.min(1.0, baseScore * 1.1);
    } else {
      baseScore = baseScore * 0.9;
    }
  }
  
  return baseScore;
}
```

## 🔗 의존성

- KRA API: API214_1 (`age`, `sex`, `rcDist`)
- DB: `horse_results.age`, `horse_results.sex`, `horse_results.rc_dist`

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 골격 작성, 전문가 자문 대기 |
