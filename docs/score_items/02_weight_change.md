# ② 마체중 변화 (구 컨디션 신호 1)

**18개 항목 중 비중 (PRD 초기):** 4.21점 (원 컨디션 13.16 × 32%)
**학습 가중치 (2026-05-25):** **0.00점** ⚠️ (ρ 음수 → 학습이 봉인)
**최신 학습 ρ:** **-0.007** (사실상 노이즈)
**카테고리:** 컨디션
**상태:** ⏸ 알고리즘 재검토 필요
**최근 업데이트:** 2026-05-26 (PRD 동기화)

> ⚠️ **실측 결과 노이즈**. PRD 의 절댓값 기반 가설("변화 작을수록 안정")이 실제 패턴과 안 맞을 가능성.
> 도메인 의견 필요: 약간의 증가(+1~3kg)는 컨디션 좋다는 신호일 수도 있음.

---

## 📊 KRA API 필드

```
wgHr: "463(+3)" 형태의 문자열
  - 463: 현재 마체중 (kg)
  - +3: 직전 경주 대비 변화량 (kg)
```

## 🔬 학술적 근거

```
한국 경마 (KRA 공식):
  - 마체중 변화 = 컨디션 지표
  - 급격한 변화 = 컨디션 조절 실패 또는 질병 신호
  - 출발 50분 전 측정

해외 연구 (Thoroughbred):
  - 2lbs(약 1kg) 차이 = 약 1마 길이 영향
  - 평균 경주마 체중: 450-550kg
  - ±5kg = 약 1% (정상 변동 범위)
  - 절대 변화보다 추세가 중요

계절적 영향:
  - 수말/거세마: 가을-겨울 최대, 여름 최저
  - 암말: 가을 최대, 봄 최저
```

## 🎯 알고리즘

```javascript
function calculateWeightChangeScore(recent5Races) {
  if (recent5Races.length === 0) return 0.5; // 데뷔전
  
  // 1. wgHr 파싱 (예: "463(+3)" → {weight: 463, diff: 3})
  const changes = recent5Races.map(r => parseWgHr(r.wgHr).diff);
  const latestChange = Math.abs(changes[0]);
  
  // 2. 변화량 기본 점수
  let baseScore;
  if (latestChange <= 2) baseScore = 1.0;       // 정상 변동 (만점)
  else if (latestChange <= 5) baseScore = 0.8;  // 양호한 증감
  else if (latestChange <= 9) baseScore = 0.4;  // 주의
  else baseScore = 0.1;                          // 위험 (10kg 이상)
  
  // 3. 추세 보정 (5경주 연속 일관된 방향)
  const trendBonus = isConsistentTrend(changes) ? +0.15 : -0.15;
  
  // 4. 계절 보정
  const sex = recent5Races[0].sex; // "수"/"거"/"암"
  const month = getCurrentMonth();
  let seasonalBonus = 0;
  if (sex === '암' && [3,4,5].includes(month) && latestChange < 0) {
    seasonalBonus = 0.1; // 봄 자연 감소
  } else if (['수','거'].includes(sex) && [6,7,8].includes(month) && latestChange < 0) {
    seasonalBonus = 0.1; // 여름 자연 감소
  }
  
  return Math.max(0.0, Math.min(1.0, baseScore + trendBonus + seasonalBonus));
}

function parseWgHr(wgHrStr) {
  const match = wgHrStr.match(/(\d+)\(([+-]?\d+)\)/);
  return { weight: parseInt(match[1]), diff: parseInt(match[2]) };
}
```

## 📊 점수 기준표

| |Δ| 변화량 | 점수 | 의미 |
|-------------|------|------|
| ≤ 2kg | **1.0** | 정상 변동 (만점) |
| 3~5kg | **0.8** | 양호한 증감 |
| 6~9kg | **0.4** | 주의 |
| ≥ 10kg | **0.1** | 위험 신호 |

**보너스:**
- 5경주 연속 일관된 추세: +0.15
- 변동성 큼: -0.15
- 계절 자연 감소 (성별별): +0.1

## ⚠️ 엣지 케이스

```
1. wgHr 형식이 다른 경우 (예: "463" 만)
   → 0.5 (중립, 데이터 부족)

2. 데뷔전 (이력 없음)
   → 0.5

3. 마체중 비정상값 (300kg 이하 또는 700kg 이상)
   → 데이터 오류 처리 (로그 + 중립값)
```

## 🔗 의존성

- KRA API: API214_1 (`wgHr`, `sex`)
- DB: `race_entries.wg_hr`, `race_entries.wg_hr_diff` (사후 채워짐). `wg_hr_str` 은 race_entries 에 통합되지 않음

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 학술 조사 + 본인 노하우 기반 확정 |
