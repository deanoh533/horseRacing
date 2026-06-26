# 🏗 시스템 아키텍처 — 큰 그림

> **역할: 구조 SSOT** (무엇이 있나). 데이터 흐름은 [data_flow](data_flow.md), 명령어는 [pipeline_guide](pipeline_guide.md).

> 이 문서는 프로젝트 전체를 한눈에 잡기 위한 최상위 문서입니다.
> 세부 흐름은 [data_flow.md](data_flow.md), 알고리즘은 [score_algorithm.md](score_algorithm.md) 참고.

---

## 1. 이 프로그램이 하는 일

KRA(한국마사회) 출마정보와 결과를 받아 두 가지를 한 화면에 제공합니다.

1. **출마정보 viewer** — 경주에 나오는 말들의 상세 정보(혈통·기수·훈련·구간기록 등)를 한 화면에 비교
2. **AI 예측 점수** — 18개 판단 항목을 알고리즘으로 점수화 → Spearman으로 학습된 가중치를 곱해 종합점수 → 예측 1·2·3위 산출

경기 후에는 결과를 받아와 **적중률을 측정**하고, 가중치를 갱신해서 모델을 점진 개선합니다.

### 미래 확장 계획 (백로그)

- 각 경주에 **AI 코멘트** (Claude API 연동)
- 경주별 **PDF 분석 보고서** 자동 생성
- 경주별 **유튜브 대본** 자동 생성

→ 위 3개는 종합점수가 안정화된 뒤 추가. 현재는 베이스 모델 완성 단계.

---

## 2. 4단계 핵심 흐름

```
   ① 수집              ② 점수화           ③ 학습              ④ 검증
┌─────────────┐    ┌─────────────┐   ┌─────────────┐    ┌─────────────┐
│ KRA Open API│ →  │ Score Engine│ → │WeightLearner│ →  │  적중률 통계 │
│ (314/316/   │    │ 18 항목     │   │ Spearman ρ  │    │ 단/연/복승, │
│  214_1 etc.)│    │ raw 0~1     │   │ → 가중치    │    │ TOP3 교집합 │
└─────────────┘    └─────────────┘   └─────────────┘    └─────────────┘
       ↓                 ↓                  ↓                  ↑
  race_entries     predictions        weight_history     predictions
```

> 단계별 상세 흐름은 [data_flow.md](data_flow.md)가 정본.

---

## 3. 예측 모드 (사전/사후)

같은 `predictRace()` 함수가 **`race_entries.ord` 컬럼의 NULL 여부**로 자동 분기합니다.

| 시점 | `ord` | 모드 | 용도 |
|---|---|---|---|
| 수~경기 직전 | NULL | **사전** | 베팅 전 화면 예측 |
| 경기 후 | 1, 2, 3, … | **사후** | 백테스트·학습 |

데이터 소스가 어떻게 달라지는지는 → [prediction_mode.md](prediction_mode.md)

---

## 4. 가중치 학습 (Spearman)

[src/engine/weightLearner.ts](../src/engine/weightLearner.ts)

```
1. 과거 predictions 가져옴
2. 경주 단위로 그룹핑
3. 각 항목 raw_score 순위 vs 실제 ord 순위 → Spearman ρ
4. ρ → optimal weights (음수는 0 클립, 합=100 정규화)
5. blended = (current + optimal) / 2  ← 점진 수렴
6. predictions.total_score 재계산
7. weight_history INSERT
```

실행:
```
npx tsx scripts/learn_weights_once.ts      # dry-run, 변화만 출력
npx tsx scripts/apply_learned_weights.ts   # 실제 적용 + 히스토리 저장
```

---

## 5. 데이터 모델 (DB)

| 테이블/뷰 | PK | 채움 |
|---|---|---|
| `race_entries` | (race_date, meet, rc_no, pthr_no) | raceCardSync / dailySync |
| `races` | (race_date, meet, rc_no) | raceCardSync / dailySync |
| `predictions` | (race_date, meet, rc_no, hr_name) | scorePredictor → dailySync / backfill |
| `weight_history` | id | apply_learned_weights |
| `training_logs` | (race_date, hr_no) | trainingSync (API18_1) |
| `jockey_stats` | jcky_no | jockeySync (jkpresult) |
| `horses` | hr_no | fetch_horse_info |
| `horse_sectional_ability` | view | 007 마이그레이션 |
| `race_sectional_stats` | view | 007 마이그레이션 |
| ~~`race_cards`, `horse_results`~~ | (구버전) | 코드 안 읽음, DROP 대기 |

---

## 6. 폴더 구조

```
projectFolder/
├─ src/                        # 백엔드/스크립트 (Node + TS)
│  ├─ kra/client.ts            # KRA API 클라이언트
│  ├─ sync/                    # 데이터 동기화
│  │  ├─ raceCardSync.ts       # 출마정보 (사전)
│  │  ├─ dailySync.ts          # 결과 (사후) + predictions
│  │  ├─ trainingSync.ts       # API18_1
│  │  ├─ jockeySync.ts         # jkpresult
│  │  └─ transformer.ts        # KRA → DB row 변환
│  ├─ engine/
│  │  ├─ index.ts              # ScoreEngine 클래스
│  │  ├─ scorePredictor.ts     # 사전/사후 자동 분기
│  │  ├─ weightLearner.ts      # Spearman 학습
│  │  └─ scoreItems/           # 18개 항목별 알고리즘
│  └─ types/index.ts           # 공통 타입, ITEM_WEIGHTS
├─ client/                     # 프론트엔드 (React + Vite + Tailwind)
│  └─ src/pages/
│     ├─ Dashboard.tsx         # 날짜별 경주 카드
│     ├─ RaceDetail.tsx        # AI 예측 화면
│     ├─ RaceEntries.tsx       # 출마정보 비교 + 펼침 6카드 (PRD v6.1)
│     └─ HorseDetail.tsx       # 말 상세
├─ scripts/                    # 백필·학습·진단 등 (50+)
├─ migrations/                 # SQL (현재 007까지)
└─ docs/                       # 본 문서들
```

---

## 7. 외부 의존 한눈에

| 의존 | 어디서 | 용도 |
|---|---|---|
| KRA Open API | data.go.kr | 출마/결과/혈통/훈련/기수 |
| Supabase | supabase.co | PostgreSQL + REST + Auth |
| Vercel | vercel.com | 프론트 배포 (main push 자동) |
| Tailwind/React/Vite | npm | 프론트 빌드 |

---

## 8. 협업 모드 (Claude)

- **SQL 쿼리·대용량 분석** → 사용자가 Supabase SQL Editor에서 실행 (토큰 절감)
- **빌드·타입체크·git** → Claude가 직접
- **출력 100줄 넘는 명령** → 사용자에게 부탁
- **서브에이전트 spawn** → `model: 'sonnet'` 명시 (메인 Opus 비용 분리)
- **DATABASE_URL** → 비밀번호 특수문자는 작은따옴표로 감싸기

---

## 9. 관련 문서 한눈에

| 문서 | 무엇 |
|---|---|
| [data_flow.md](data_flow.md) | 수집·UPDATE·운영 시나리오 상세 |
| [score_algorithm.md](score_algorithm.md) | 18 항목별 알고리즘 + 수정 가이드 |
| [prediction_mode.md](prediction_mode.md) | 사전/사후 데이터 소스 차이표 |
| [accuracy_metrics.md](accuracy_metrics.md) | 적중률 4개 지표 정의 |
| [data_lifecycle.md](data_lifecycle.md) | 출마표 발표·결과 도착 시점 |
| [troubleshooting.md](troubleshooting.md) | 현재 발견된 의문·수정 요망점 |
| [kra_api_quirks.md](kra_api_quirks.md) | KRA API 컬럼명 함정 |
| [PRD_v6.1_entries_view.md](PRD_v6.1_entries_view.md) | 출마정보 화면 PRD |
| [PRD_v6.1_race_info_legend.md](PRD_v6.1_race_info_legend.md) | 에이스경마 1-34번 매핑 |
| [TODO.md](../TODO.md) | 우선순위 할일 |
