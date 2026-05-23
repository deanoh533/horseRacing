# 🤖 AI 인사이트 시스템 (Claude API)

**전략:** 하이브리드 (배치 + Lazy)
**모델:** Claude Haiku 4.5
**예상 비용:** 월 ~$0.12 (160원)
**최종 업데이트:** 2026-05-22

---

## 🎯 호출 전략 - 하이브리드

### 1. 배치 (사전 생성) - 매일 새벽 3시

```
대상: 화면 1 (대시보드)용 인사이트
  - 경주당 1줄 요약 ("1-2위 박빙, 천리마 거리·궁합 강점")
  - 복병마 인사이트 ("최근 컨디션 급상승!")

호출 수: 약 18-20회/일 (서울+부산경남 모든 경주)
저장: race_insights 테이블 (영구 보관)
```

### 2. Lazy (클릭 시) - 사용자 액션

```
대상: 화면 3 (말 상세)용 인사이트
  - 인사이트 지표 4개에 대한 자연어 분석
  - 사용자가 클릭한 말만 호출

캐시 정책:
  - 24시간 유효
  - 사용자 인사이트 지표 변경 시 무효화
  - 가중치 학습 후 무효화

호출 수: 평균 20회/일 (5말 × 4인사이트)
저장: horse_insights 테이블 (24h TTL)
```

---

## 📊 비용 예측

```
[하루 호출]
  배치: 18-20회 × 100토큰 = 약 2,000토큰
  Lazy: 20회 × 100토큰 = 약 2,000토큰
  합계: 약 4,000토큰

[월 비용]
  Input: 120K × $0.25/1M = $0.03
  Output: 120K × $1.25/1M = $0.15
  합계: 약 $0.18 (240원)

[연 비용]
  약 $2.2 (3,000원)
```

---

## 🗄️ DB 스키마 (캐싱)

```sql
-- 경주 단위 인사이트 (배치)
CREATE TABLE race_insights (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  insight_type VARCHAR(20) NOT NULL,
  -- 종류: 'summary', 'dark_horse', 'top1_analysis'
  insight_text TEXT NOT NULL,
  prompt_hash VARCHAR(64),  -- 같은 데이터 변경 감지용
  generated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (race_date, meet, rc_no, insight_type)
);

-- 말 단위 인사이트 (Lazy + 캐시)
CREATE TABLE horse_insights (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  hr_name VARCHAR(30) NOT NULL,
  indicator_id VARCHAR(30) NOT NULL,
  -- 종류: '03_recent_form', '06_distance_fitness', etc.
  insight_text TEXT NOT NULL,
  generated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,  -- 24h 후
  PRIMARY KEY (race_date, meet, rc_no, hr_name, indicator_id)
);

CREATE INDEX idx_horse_insights_expires ON horse_insights(expires_at);
```

---

## 🧮 알고리즘 - 배치 (매일 새벽)

```javascript
// cron: 0 3 * * * (매일 03:00)
async function generateDailyInsights() {
  const today = formatDate(new Date());
  
  for (const meet of [1, 3]) {  // 서울, 부산경남
    const races = await db.query(`
      SELECT * FROM races 
      WHERE race_date = $1 AND meet = $2
    `, [today, meet]);
    
    for (const race of races) {
      // 출전마 데이터 + 점수 가져오기
      const horses = await getRaceHorsesWithScores(race);
      
      // 1. 경주 요약 인사이트
      const summary = await generateRaceSummary(horses);
      await saveInsight(race, 'summary', summary);
      
      // 2. 복병마 인사이트 (있을 경우)
      const darkHorse = findDarkHorse(horses);
      if (darkHorse) {
        const insight = await generateDarkHorseInsight(darkHorse);
        await saveInsight(race, 'dark_horse', insight);
      }
    }
  }
}

async function generateRaceSummary(horses) {
  const [first, second, third] = horses.slice(0, 3);
  
  const prompt = `경마 분석 한 문장 작성:
1위: ${first.hrName} ${first.score}점
2위: ${second.hrName} ${second.score}점
3위: ${third.hrName} ${third.score}점
1-2위 차: ${first.score - second.score}점

형식: "💡 [핵심 인사이트] (한 문장 50자 이내)"
예시: "1-2위 박빙, 천리마는 거리·궁합 강점"`;
  
  const response = await claude.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 50,
    messages: [{ role: 'user', content: prompt }]
  });
  
  return response.content[0].text;
}
```

---

## 🧮 알고리즘 - Lazy (클릭 시)

```javascript
async function getHorseInsight(race, hrName, indicatorId) {
  // 1. 캐시 확인
  const cached = await db.query(`
    SELECT insight_text FROM horse_insights
    WHERE race_date=$1 AND meet=$2 AND rc_no=$3 
      AND hr_name=$4 AND indicator_id=$5
      AND expires_at > NOW()
  `, [race.race_date, race.meet, race.rc_no, hrName, indicatorId]);
  
  if (cached.length > 0) {
    return cached[0].insight_text;  // 즉시 반환
  }
  
  // 2. 캐시 없으면 API 호출
  const horseData = await getHorseDetailData(race, hrName, indicatorId);
  const insight = await generateHorseInsight(horseData, indicatorId);
  
  // 3. DB 저장 (24h TTL)
  await db.query(`
    INSERT INTO horse_insights 
    (race_date, meet, rc_no, hr_name, indicator_id, 
     insight_text, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours')
    ON CONFLICT (race_date, meet, rc_no, hr_name, indicator_id) 
    DO UPDATE SET insight_text = EXCLUDED.insight_text,
                  expires_at = NOW() + INTERVAL '24 hours'
  `, [race.race_date, race.meet, race.rc_no, hrName, 
      indicatorId, insight]);
  
  return insight;
}

async function generateHorseInsight(horseData, indicatorId) {
  const prompts = {
    '03_recent_form': `착순 추세 분석 (50자 이내):
      말: ${horseData.hrName}
      최근 5경주: ${horseData.recent5.join('-')}
      
      형식: "💡 [핵심 의미] (한 문장)"`,
    
    '06_distance_fitness': `거리 적성 분석 (50자 이내):
      거리: ${horseData.rcDist}m
      이력: ${horseData.distHistory}
      
      형식: "💡 [핵심 의미] (한 문장)"`,
    
    '09_jockey_form': `기수 폼 분석 (50자 이내):
      기수: ${horseData.jkName}
      30일: ${horseData.jockey30days}
      
      형식: "💡 [핵심 의미] (한 문장)"`,
    
    '16_jockey_horse_chemistry': `궁합 분석 (50자 이내):
      조합 이력: ${horseData.combination}
      
      형식: "💡 [핵심 의미] (한 문장)"`
  };
  
  const response = await claude.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 60,
    messages: [{ role: 'user', content: prompts[indicatorId] }]
  });
  
  return response.content[0].text;
}
```

---

## 🔄 캐시 무효화

```javascript
// 사용자 인사이트 지표 변경 시
async function onInsightIndicatorChange(userId, newIndicators) {
  // 기존 캐시 삭제 (해당 사용자만)
  await db.query(`
    DELETE FROM horse_insights
    WHERE user_id = $1
  `, [userId]);
  
  // 다음 호출 시 새로 생성
}

// 가중치 학습 후
async function onWeightLearning() {
  // race_insights는 점수 변경되니 무효화
  await db.query(`
    DELETE FROM race_insights
    WHERE generated_at < $1
  `, [lastLearningDate]);
}
```

---

## ⚠️ 한도 관리

```javascript
const MONTHLY_LIMIT = 5;  // $5
const DAILY_LIMIT = 0.2;  // $0.2

async function checkBudget() {
  const monthlyUsage = await getMonthlyUsage();
  const dailyUsage = await getDailyUsage();
  
  if (monthlyUsage >= MONTHLY_LIMIT) {
    throw new Error('월 한도 초과 - 다음 달까지 API 호출 중단');
  }
  
  if (dailyUsage >= DAILY_LIMIT) {
    console.warn('일일 한도 초과 - 사용 자제');
  }
}

// 한도 초과 시 fallback
function fallbackInsight(category) {
  const rules = {
    'recent_form': "최근 5경주 데이터 확인",
    'distance_fitness': "거리 적성 데이터 참고",
    // ...
  };
  return rules[category];
}
```

---

## 📊 모니터링 (대시보드)

```
설정 페이지에 표시:
  📊 AI 사용량
  ─────────
  이번 달: $0.08 / $5.00 (1.6%)
  오늘: $0.003 / $0.20 (1.5%)
  
  📈 호출 통계 (최근 30일)
  - 배치 호출: 540회 (월 9,000원 추정)
  - Lazy 호출: 420회 (캐시 활용 75%)
```

---

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 하이브리드 전략 확정 (배치 + Lazy) |
| 2026-05-22 | Claude Haiku 4.5 선택 (저비용) |
