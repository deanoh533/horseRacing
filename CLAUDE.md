# KRA 경마 분석 도구 — Claude 컨텍스트

> 새 세션에서 이 파일을 가장 먼저 읽습니다.
> 마지막 업데이트: 2026-05-30 (부경 구간 개별 타임 8개 컬럼 추가 + backfill 완료)

---

## 🎯 한 줄 요약

KRA(한국마사회) 출마정보를 한 화면에 비교하고, 21개 항목 알고리즘 × Spearman 학습 가중치로 종합점수를 만들어 경주 1·2·3위를 예측한 뒤 결과로 적중률을 측정하는 개인용 분석 도구.

미래 계획: 경주별 AI 코멘트 / PDF 보고서 / 유튜브 대본 자동 생성.

---

## 📐 4단계 핵심 흐름

```
   ① 수집              ② 점수화           ③ 학습              ④ 검증
┌─────────────┐    ┌─────────────┐   ┌─────────────┐    ┌─────────────┐
│  KRA Open   │ →  │ ScoreEngine │ → │WeightLearner│ →  │  적중률 통계 │
│    API      │    │ 18 항목     │   │ Spearman ρ  │    │ 단/연/복승, │
│             │    │ raw 0~1     │   │ → 가중치    │    │ TOP3 교집합 │
└─────────────┘    └─────────────┘   └─────────────┘    └─────────────┘
       ↓                 ↓                  ↓                  ↑
  race_entries     predictions        weight_history     predictions
```

---

## 🛠 기술 스택

- **프론트엔드:** React + Vite + Tailwind ([client/](client/))
- **백엔드/스크립트:** Node.js + TypeScript ([src/](src/), [scripts/](scripts/)) — **로컬 수동 실행 전용** (상시 서버 X). Vercel에는 `client/`만 배포.
- **DB:** Supabase (PostgreSQL)
- **배포:** Vercel — main push 시 자동 배포 (`horse-racing-xi-one.vercel.app`)

---

## ⚡ 개발 시작

```bash
# 1. 환경 변수 설정
cp .env.example .env  # 아래 키 필수 입력

# 2. 의존성 설치
npm install && cd client && npm install && cd ..

# 3. 개발 서버 실행 (각각 별도 터미널)
npm run dev          # 백엔드 (포트 3000)
npm run client:dev   # 프론트엔드 (포트 5173)

# 타입체크 / 테스트
npm run build        # tsc 전체 타입체크
npm run test:run     # vitest 단위 테스트
```

**필수 환경 변수** (`.env.example` 참고):
- `KRA_API_KEY` — data.go.kr 공공데이터 포털 발급
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — `sk-ant-...` 형식

---

## 🗂 핵심 테이블

| 테이블/뷰 | 역할 | 채움 |
|---|---|---|
| `race_entries` | **사전+사후 통합 테이블** (PK: race_date·meet·rc_no·pthr_no) | raceCardSync / dailySync |
| `races` | 경주 메타 (거리·주로·날씨) | raceCardSync / dailySync |
| `predictions` | 경주마별 종합점수 + 항목점수 | dailySync / backfill |
| `weight_history` | Spearman 학습 가중치 변천 | apply_learned_weights |
| `horse_sectional_ability` | 마별 통산 구간 능력치 (view) | 007 마이그레이션 |
| `horse_running_style_by_distance` | 거리별 마필 주행 성향 (view) | 008 마이그레이션 |
| `race_sectional_stats` | 경주별 페이스 통계 (view) | 007 마이그레이션 |
| `training_logs` | 일별 훈련 기록 | trainingSync (API18_1) |
| `jockey_stats` | 기수 통산 성적 | jockeySync (jkpresult) |
| `horses` | 말 정보 + 혈통 | fetch_horse_info |

→ 전체 구조·관계는 [docs/architecture.md §5](docs/architecture.md#5-데이터-모델-db)

---

## 🔀 예측 모드 — 사전/사후

같은 `predictRace()`가 **`race_entries.ord` NULL 여부**로 자동 분기.

| 시점 | `ord` | 모드 |
|---|---|---|
| 수~경기 직전 | NULL | 사전 (베팅 전 예측) |
| 경기 후 | 1·2·3·… | 사후 (백테스트·학습) |

상세 데이터 출처 차이 → [docs/prediction_mode.md](docs/prediction_mode.md)

---

## 📆 한 주의 흐름

| 요일 | 이벤트 | 명령 |
|---|---|---|
| 수 오후 | 금경 출마표 발표 | `sync:racecard --date YYYYMMDD` |
| 목 오후 | 토경 출마표 발표 | 〃 |
| 금 오후 | 일경 출마표 발표 | 〃 |
| 금 밤 | 금경 결과 도착 | `sync:daily --date YYYYMMDD` |
| 토 밤 | 토경 결과 도착 | 〃 |
| 일 밤 | 일경 결과 도착 | 〃 |
| 주중 | 가중치 학습 (선택) | `apply_learned_weights.ts` |

상세 → [docs/data_lifecycle.md](docs/data_lifecycle.md)

---

## 🤝 협업 모드 (Claude)

- **PM/기획** → 단계별 의논 필수, 추측 단독 작성 X
- **SQL 쿼리·대용량 분석** → 사용자가 Supabase SQL Editor에서 실행 (토큰 절감)
- **빌드·타입체크·git** → Claude 직접
- **출력 100줄 넘는 명령** → 사용자에게 부탁
- **서브에이전트 spawn** → `model: 'sonnet'` 명시 (메인 Opus 비용 분리)
- **선택지 제시** → AskUserQuestion 버튼 UI 사용

---

## 📚 문서 인덱스

### 큰그림·아키텍처
- [docs/architecture.md](docs/architecture.md) — **시스템 전체 그림** (시작 추천)
- [docs/data_flow.md](docs/data_flow.md) — KRA API → DB → ScoreEngine → UI 전체 흐름
- [docs/data_lifecycle.md](docs/data_lifecycle.md) — 출마표 발표·결과 도착 시점

### 알고리즘·예측
- [docs/score_algorithm.md](docs/score_algorithm.md) — 18 항목 알고리즘 + 수정 가이드
- [docs/score_roadmap.md](docs/score_roadmap.md) — **평가항목 고도화 로드맵** (클린 슬레이트 비교·변경 이력 Living Doc)
- [docs/prediction_mode.md](docs/prediction_mode.md) — 사전/사후 데이터 소스 차이
- [docs/accuracy_metrics.md](docs/accuracy_metrics.md) — 적중률 4개 지표 정의

### 화면·기능
- [docs/PRD_v6.1_entries_view.md](docs/PRD_v6.1_entries_view.md) — 출마정보 화면 PRD
- [docs/PRD_v6.1_race_info_legend.md](docs/PRD_v6.1_race_info_legend.md) — 에이스경마 1-34번 매핑

> **UI 현황 (2026-05-28):** 예상지 = 모바일 2+2 그리드 / 데스크탑 4열(`grid-cols-2 md:[grid-template-columns:2fr_1.2fr_3fr_2fr]`). 아코디언 레이아웃 미사용(사용자 확인). Col5Items = 가중치 상위 5개 동적 표시. RaceInfoBlock 공통 헤더(3개 화면 공유), 조교 이력 추가 완료. 대시보드 개발 용어 제거·모바일 버튼 개선 완료.
>
> **training_logs 주의:** `st_time`/`sp_time`은 YYYYMMDDHHmmss 타임스탬프 (훈련 시작/종료 시각). 실제 소요시간은 `tr_term`(초). `pr_gubun` 범례: 이름=기수, 조=조교사, 관=주로조교, 생=교육생, 이름(트)=기수트랙라이더.

### 운영·디버깅
- [docs/kra_api_quirks.md](docs/kra_api_quirks.md) — KRA API 컬럼명 함정
- [docs/troubleshooting.md](docs/troubleshooting.md) — 현재 발견된 의문·수정점
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 배포 메모

### 세션 인계 (새 세션 정독 추천)
- [docs/working_style.md](docs/working_style.md) — **시니어 개발자 + 설계자 관점, 협업 패턴**
- [docs/running_style_insight.md](docs/running_style_insight.md) — 주행 성향 분류 큰그림·현재 위치·다음 단계 (⑤⑥⑫⑲ 완료 / ⑲ 스코어맵 재설계 대기)
- [docs/superpowers/specs/2026-05-28-score-redesign-design.md](docs/superpowers/specs/2026-05-28-score-redesign-design.md) — **점수 알고리즘 재설계 스펙** (3단계 전체 완료)

### 할일
- [TODO.md](TODO.md) — 우선순위별 할일

---

## ⚠️ 지금 알아야 할 핵심 이슈

> **2026-05-28 T-016 가중치 재학습 완료** → 단승 32.5% / 연승 52.8% / 복승 65.9% (⑲ SEALED + ⑨b⑩b 반영)

**완료된 작업 (2026-05-30):**
- ✅ API4_3 vs API214_1 전수 비교 — API214_1이 필드 더 많음 (교체 불필요). 상세: docs/kra_api_quirks.md Quirk 8
- ✅ 부경 구간 개별 타임 8개 컬럼 신설 (`bu_s1f_time`, `bu_1fg_time`~`bu_10_8f_time`) + backfill 완료
  - 향후 구간기록 테이블 UI 구현 시 즉시 활용 가능

**완료된 작업 (2026-05-28):**
- ✅ ①레이팅 경주 내 percentile 재설계 (T-015)
- ✅ ⑦④ SEALED (ρ 역상관), blendWeights alpha=1.0 직접 매핑
- ✅ ⑨b 기수 최근 3개월 단승률 (ρ=0.201), ⑩b 조교사 최근 3개월 복승률 (ρ=0.144) 신규
- ✅ ⑲ 주행성향×페이스 구현 완료 — 단, 실측 ρ=-0.010 (weight=0). 스코어맵이 한국 실측과 역전됨. 데이터 50k+ 후 재설계 예정.

**현재 주요 ρ (2026-05-28 측정, n=37k+):**

| 항목 | ρ | 비고 |
|---|---|---|
| ⑥ 거리적성 | 0.565 | 1위 |
| ⑤ 후반순위 | 0.347 | 2위 |
| ⑧ 부담중량 | 0.316 | 핸디캡=능력proxy, 산식 개선 여지 |
| ③ 최근형 | 0.290 | |
| ⑱ 수득상금 | 0.256 | |
| ⑨b 기수 최근폼 | 0.201 | 신규, 통산(0.137)보다 강함 |
| ⑲ 주행성향×페이스 | -0.010 | weight=0, 스코어맵 재설계 대기 |

**다음 개선 후보:**
- ⑧ 부담중량 산식 고도화 (ρ=0.316, 전문가 자문 대기)
- ⑲ 스코어맵 재설계 (도주+HOT 실측 21%, 추입+HOT 실측 4% — 서양 이론과 역전)

→ 자세한 건 [TODO.md](TODO.md) P0 섹션 / [docs/troubleshooting.md](docs/troubleshooting.md)

---

## DB 현황 (2026-05-30 기준)

| 테이블/뷰 | rows |
|---|---|
| race_entries | 37,453 |
| races | 3,585 |
| predictions | 38,517 |
| training_logs | 6,540 |
| jockey_stats | 59 (서울 34·부경 25) |
| horses | 2,864 (모두 혈통 있음) |

서울 구간기록 backfill: 2024 100% / 2025 97.3% / 2026 97.9% (부경 99.9%) — 에러 ~3%는 KRA 원천 없음

**race_entries 구간 컬럼 현황 (2026-05-30):**
- 서울: 누적시간(se_s1f/g1f/g3f/1c~4c) + 순위(sj_s1f/g1f/g3f/1c~4c) ✅
- 부경: 누적시간(bu_s1f/g1f~g8f) + 순위(bu_g1f~g4f/s1f) + **개별 구간 타임(bu_s1f_time/bu_1fg~bu_10_8f_time) ✅ 신규**
- 부경 G5f·G6f·G7f·G8f 순위: KRA API 미제공 (구조적 공백)
