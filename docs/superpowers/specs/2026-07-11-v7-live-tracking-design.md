# v7 라이브 적중률 추적 설계 (L-001)

> 작성: 2026-07-11 · 승인: 사용자  
> v7 모델의 실전 성능을 정직하게 판정하기 위해 predictions 테이블의 쓰기 전략 재설계

---

## 1. 개요

**목표:**  
v7 모델이 라이브 환경에서 실제로 얼마나 잘 맞추는가를 정직하게 판정

**현재 문제:**
- dailySync에서 금요일에 predictions을 DELETE → INSERT (사후 예측 재계산)
- 수요일의 사전 예측이 손실됨
- 화면 "오늘의 강추"가 과거 잔재로 오염
- 방어 필터(7일)로 임시 대응 중

**해결책:**
- dailySync에서 predictions 계산 제거 (skipPredictions=true)
- predictions은 수요일에 한 번만 저장, 이후 무변경
- race_entries에만 금요일 결과(ord) 저장
- 화면 필터를 명확하게 변경 (race_date=TODAY)

---

## 2. 아키텍처

### 2.1 변경 전

```
수요일 (raceCardSync)
  ├─ race_entries INSERT (ord=NULL)
  └─ predictions INSERT (사전 예측)
  
금요일 (dailySync)
  ├─ race_entries UPDATE (ord=2)
  ├─ predictions DELETE (기존 제거) ❌ 손실!
  └─ predictions INSERT (사후 예측 재계산)

화면 "오늘의 강추"
  ├─ predictions 읽기
  └─ 방어 필터(7일 이내) ← 복잡
```

### 2.2 변경 후

```
수요일 (raceCardSync)
  ├─ race_entries INSERT (ord=NULL)
  └─ predictions INSERT (사전 예측) ✓ 보존됨

금요일 (dailySync)
  ├─ race_entries UPDATE (ord=2) ✓ 결과만 저장
  └─ predictions 무변경 ✓

화면 "오늘의 강추"
  ├─ predictions 읽기
  └─ race_date=TODAY 필터 ← 명확함
  
라이브 판정
  ├─ predictions (사전 예측)
  ├─ race_entries (실제 결과)
  └─ JOIN → 적중률 계산
```

### 2.3 테이블 (변경 없음)

**predictions**
```
race_date, meet, rc_no, hr_name,
predicted_rank, total_score, item_scores,
p_top3, p_win,
model_version,
actual_ord (NULL 유지)  ← 사전 모드이므로
```

**race_entries**
```
race_date, meet, rc_no, hr_name, ...,
ord (금요일에만 채워짐)  ← 결과 저장소
```

---

## 3. 구현 상세

### 3.1 dailySync.ts 수정

**변경 전:**
```typescript
// 5. Score Engine → predictions upsert (백필 시 생략)
if (!skipPredictions) {
  const predictions = await predictRace(sb, rcDate, meet, rcNo);
  await sb.from('predictions').delete()
    .eq('race_date', rcDate).eq('meet', meet).eq('rc_no', rcNo);
  await sb.from('predictions').insert(predictions);
}
```

**변경 후:**
```typescript
// 5. predictions 계산 제거 (수요일 데이터 보존)
// skipPredictions은 이제 기본값 true
// (또는 라인 전체 삭제)

// race_entries 결과만 저장 (이미 기존 로직)
await sb.from('race_entries').upsert([...], { onConflict: '...' });
```

### 3.2 화면: client/src/lib/queries.ts

**변경 전 (TodayPicks):**
```typescript
const recentRaceDate = getRecentUnsyncedRaceDate();
WHERE predictions.p_top3 >= 0.72
  AND predictions.race_date >= (recentRaceDate - 7)  // 방어 필터
```

**변경 후:**
```typescript
const today = getTodayRaceDate();
WHERE predictions.p_top3 >= 0.72
  AND predictions.race_date = today
```

### 3.3 에러 처리: dailySync 보충 로직

예측이 없는 경주 (수요일 실패 경우)를 금요일에 보충:

```typescript
// dailySync에서 각 경주마다
const hasPrediction = await checkExists(
  'predictions', 
  { race_date, meet, rc_no }
);

if (!hasPrediction) {
  console.warn(`⚠️ ${rcNo}번 예측 없음 → 금요일 보충`);
  
  const predictions = await predictRace(sb, rcDate, meet, rcNo, {
    forcePrecompetition: true  // ← 사전 모드 강제
  });
  
  await sb.from('predictions').insert(predictions);
}
```

**조건:**
- 보충 예측도 사전 모드 (ord 무시)
- actual_ord = NULL (결과 미기록)
- 라이브 판정에 포함됨

### 3.4 신규 스크립트: probe_v7_accuracy.ts

v7 라이브 적중률 판정 스크립트

```bash
npm run probe:v7-accuracy [--from YYYYMMDD] [--to YYYYMMDD]
```

**출력:**
```
강추 (p_top3 >= 0.72) 연승률: 73.1% (37/50)
주목 (p_top3 >= 0.62) 연승률: 65.4% (98/150)
전체 연승률: 61.9% (...)
```

**로직:**
1. predictions JOIN race_entries (ord 조회)
2. p_top3 임계값별 분류 (강추/주목/전체)
3. ord <= 3 이면 적중, NULL이면 제외
4. 적중률 계산

---

## 4. 데이터 흐름

### 수요일 (raceCardSync)

```
1. KRA 출마표 API
   ↓
2. race_entries INSERT
   race_date=20260712, meet=서울, rc_no=1,
   hr_name=불타올라, ord=NULL
   ↓
3. predictRace() 계산 (사전 모드)
   입력: 마체중·기수·최근폼 (경기 전만)
   ↓
4. predictions INSERT ✓ (이후 무변경)
   predicted_rank=1, total_score=0.68,
   p_top3=0.75, model_version=7, actual_ord=NULL
```

### 금요일 (dailySync)

```
1. KRA 결과 API
   ↓
2. race_entries UPDATE
   ord=2 (실제 결과)
   ↓
3. 예측 재계산 안 함 ✓
   (skipPredictions=true)
   ↓
4. predictions 무변경 ✓
   (수요일 데이터 그대로)
   
[예측이 없는 경우만]
5. 보충 예측 (사전 모드)
   forcePrecompetition=true
   predictions INSERT
```

### 언제든 (라이브 판정)

```
SELECT predictions.*, race_entries.ord
FROM predictions
LEFT JOIN race_entries ON (...)
WHERE predictions.p_top3 >= 0.72
  AND race_entries.ord <= 3
  
→ 강추 적중률 계산
```

---

## 5. 테스트 계획

### 5.1 단위 테스트

- `forcePrecompetition` 옵션: ord=NULL로 강제 계산 확인
- 화면 필터: race_date=TODAY만 표시되는지 확인
- 보충 로직: 예측 없는 경주 감지 및 삽입 확인

### 5.2 통합 테스트

1. **수요일 출마표 발표**
   - raceCardSync 실행
   - predictions에 사전 예측 저장 확인

2. **금요일 경기 결과**
   - dailySync 실행
   - race_entries ord 업데이트 확인
   - predictions 무변경 확인

3. **라이브 판정**
   - probe:v7-accuracy 실행
   - 강추 적중률 계산 및 출력 확인

### 5.3 수동 테스트 (배포 전)

- 화면 "오늘의 강추" 표시 (오늘 경주만)
- 과거 경주 섞이지 않음
- 예측 없는 경주 보충 작동 확인

---

## 6. 리스크 및 제약

| 항목 | 설명 | 완화책 |
|---|---|---|
| **skipPredictions 변경** | 기본값을 true로 변경 시 기존 동작 변함 | 명시적 주석, 로그 기록 |
| **예측 누락** | 수요일 실패 경우 기록 없음 | 금요일 보충 로직 (사전 모드) |
| **화면 호환성** | 기존 방어 필터 제거 | 새 필터(race_date=TODAY) 철저히 테스트 |
| **백테스트 영향** | 없음 (점수 계산 동일) | 문서 확인 (prediction_mode.md) |

---

## 7. 롤백 계획

문제 발생 시:
```bash
# 이전 버전으로 되돌리기
git revert <commit-hash>

# 또는 skipPredictions=false로 임시 복구
```

---

## 8. 다음 단계

### Phase 1 (이번 주말)
- [ ] dailySync 수정 배포
- [ ] 화면 필터 변경 배포
- [ ] v7 라이브 추적 시작

### Phase 2 (다음 주)
- [ ] 라이브 판정 스크립트 추가
- [ ] 강추 히스토리 뷰 (선택사항)
- [ ] 1주일 적중률 데이터 수집

### Phase 3
- [ ] v7 성능 리포트 작성
- [ ] 다음 모델 버전 계획 (필요 시)

---

## 체크리스트

- [ ] 코드 변경 완료
- [ ] 테스트 통과
- [ ] 문서 갱신 (README, API 명세 등)
- [ ] 화면 회귀 테스트
- [ ] 라이브 판정 스크립트 검증
- [ ] 사용자 수동 테스트
- [ ] 배포
