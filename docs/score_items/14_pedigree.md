# ⑪ 혈통 (3대)

**14개 항목 중 비중:** 5점
**상태:** ⏸ 전문가 자문 대기 (구조만 확정)
**최근 업데이트:** 2026-05-22

---

## 📊 KRA API 필드

### API 1: `API284/HorseBloodBasicInfo`
```
dsaBriVl: 부마 가치 지수
dsaClcVl: 종합 가치
dsaIerVl: 모마 가치
dsaPrfVl: 성적 가치
dsaCoiRt: 교배 적합률
dsaCtdIndxVl: 인덱스
dsidxVl: 거리 적합 지수
```

### API 2: `horseinfohi/gethorseinfohi`
```
sireHrnm: 부마명 (예: "테스타마타")
damHrnm: 모마명 (예: "매그니피센트마인")
spcsNm: 품종 ("더러브렛")
pctyNm: 산지 ("한국")
```

## 🎯 혈통 비중 (PRD)

```
부마 (父馬): 50%
모마 (母馬): 30%
모부마 (母父馬): 20%

→ 모부마는 damHrnm을 다시 검색하면 그 말의 sireHrnm
```

## 🧮 계산 방식 (PRD 원문)

```javascript
async function calculatePedigreeScore(hrNo, rcDist) {
  const horseInfo = await getHorseInfo(hrNo); // horseinfohi
  
  // 부마/모마/모부마 자손들의 같은 거리 구간 3위 이내 비율
  const sireScore = await getOffspringScore(horseInfo.sireHrnm, rcDist);
  const damScore = await getOffspringScore(horseInfo.damHrnm, rcDist);
  const damSireScore = await getDamSireScore(horseInfo.damHrnm, rcDist);
  
  // 자손 10건 이상 필요, 미달 시 0.5 중립
  
  return sireScore * 0.5 + damScore * 0.3 + damSireScore * 0.2;
}
```

## ⏸ 전문가 자문 필요

```
1. 부마별 거리 특성 DB 구축 (또는 별도 데이터 소스?)
2. 모마/모부마 비중 수치 검증 (50/30/20이 맞나?)
3. 자손 최소 기준 (현재 10건)
4. dsaBriVl 등 KRA 지수 활용도?
```

## 💡 dsaBriVl 등 활용 옵션

```
방법 A: KRA가 이미 계산한 지수 활용 (간단)
  - dsaBriVl, dsaClcVl, dsaIerVl 직접 사용
  - 정규화하여 0~1 점수화

방법 B: 직접 계산 (정교)
  - 자손들의 거리별 성적 직접 조회
  - 더 많은 API 호출 필요

방법 C: 두 가지 혼합
  - 우선 KRA 지수로 빠르게
  - 검증 시 직접 계산
```

## ✅ 검증 결과

- `API284/HorseBloodBasicInfo` 정확히 동작 확인
- `horseinfohi/gethorseinfohi` 부마/모마 추출 가능
- 모부마는 추가 호출 1회 필요

## 🔗 의존성

- KRA API: 
  - API284/HorseBloodBasicInfo
  - horseinfohi/gethorseinfohi
- DB: `horses` 테이블 (캐싱)

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | KRA API 검증, dsaBriVl 필드 확인 |
| 2026-04 | 초기 PRD 구조만 확정 |
