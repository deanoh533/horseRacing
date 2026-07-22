# KRA 경마 분석 도구 — Claude 컨텍스트

> 새 세션에서 이 파일을 가장 먼저 읽습니다.
> 마지막 업데이트: 2026-06-26 (선별 표시 트랙 main 머지 + 현재상태 섹션 슬림화)

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
│    API      │    │ 21 항목     │   │ Spearman ρ  │    │ 단/연/복승, │
│             │    │ raw 0~1     │   │ → 가중치    │    │ TOP3 교집합 │
└─────────────┘    └─────────────┘   └─────────────┘    └─────────────┘
       ↓                 ↓                  ↓                  ↑
  race_entries     predictions        weight_history     predictions
```

---

## 🛠 기술 스택

- **프론트엔드:** React + Vite + Tailwind ([client/](client/))
- **백엔드/스크립트:** Node.js + TypeScript ([src/](src/), [scripts/](scripts/)) — **로컬 수동 실행 + GitHub Actions 무인 sync** (상시 서버 X). Vercel에는 `client/`만 배포.
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
| 수 오후 | **금·토·일 출마표 일괄 발표** (서울+부경 동시) | `sync:cards` (인자 생략 시 주말 3일치) |
| 금 밤 | 금경 결과 도착 | `sync --date YYYYMMDD` |
| 토 밤 | 토경 결과 도착 | 〃 |
| 일 밤 | 일경 결과 도착 | 〃 |
| 주중 | 가중치 학습 (선택) | `apply_learned_weights.ts` |

> 출마표는 수요일 오후에 금·토·일 3일치가 한 번에 발표된다(docs/data_lifecycle.md). 무인 cron은 수·목·금 15시 실행되며 각 회차가 **남은 주말 전체**를 받는다(수=금토일, 목=토일, 금=일 — 수요일 조기 노출 + 목·금 재실행으로 제외마 등 임박 변경 갱신).
> 위 sync 명령은 2026-07-12부터 GitHub Actions로 무인 실행 (수동 실행도 가능) — .github/workflows/sync.yml

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
- [docs/pipeline_guide.md](docs/pipeline_guide.md) — **파이프라인 실전 가이드**: 4개 데이터 소스 역할·라이브 예측 흐름·핵심 스크립트·전체 명령어. ⚠️ 새 스크립트·학습·검증 방법 추가 시 갱신
- [docs/data_flow.md](docs/data_flow.md) — **KRA API → DuckDB → ScoreEngine → Gate A/B → Benchmark → UI 전체 파이프라인** (2026-06-12 갱신)
- [docs/data_lifecycle.md](docs/data_lifecycle.md) — 출마표 발표·결과 도착 시점

### 알고리즘·예측
- [docs/score_algorithm.md](docs/score_algorithm.md) — 알고리즘 흐름 + **수정 가이드** (항목 목록·비중·산식은 roadmap·score_items 위임)
- [docs/score_roadmap.md](docs/score_roadmap.md) — **평가항목 고도화 로드맵** (클린 슬레이트 비교·변경 이력 Living Doc)
- [docs/feature_catalog.md](docs/feature_catalog.md) — **v7 피처 카탈로그 (SSOT)**: 라이브 모델이 먹는 raw 피처 전체의 측정 기준·산식. ⚠️ buildFeatures 변경 시 함께 갱신
- [docs/prediction_mode.md](docs/prediction_mode.md) — 사전/사후 데이터 소스 차이
- [docs/accuracy_metrics.md](docs/accuracy_metrics.md) — **지표 관리 통합 문서**: 적중률 4개 지표 + Gate A/B 검증 표준 + 멀티모델 벤치마크 레이어. ⚠️ 새 검증/학습 방법 추가 시 이 문서도 갱신

### 화면·기능
- [docs/PRD_v6.1_entries_view.md](docs/PRD_v6.1_entries_view.md) — 출마정보 화면 PRD
- [docs/PRD_v6.1_race_info_legend.md](docs/PRD_v6.1_race_info_legend.md) — 에이스경마 1-34번 매핑

> **UI 현황·HorseCard 컬럼순서·`lib/sectional.ts` 유틸·training_logs 함정 → [docs/status/06-ui.md](docs/status/06-ui.md) (SSOT)**

### 운영·디버깅
- [docs/api_spec.md](docs/api_spec.md) — **API 전체 명세 (SSOT)**: KRA 9개 엔드포인트·Supabase 스키마·React Query 훅·Claude API. ⚠️ **API 변경(엔드포인트·파라미터·필드·스키마) 시 이 문서를 함께 갱신**
- [docs/kra_api_quirks.md](docs/kra_api_quirks.md) — KRA API 컬럼명 함정
- [docs/troubleshooting.md](docs/troubleshooting.md) — 현재 발견된 의문·수정점
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 배포 메모

### 세션 인계 (새 세션 정독 추천)
- [docs/status/](docs/status/) — **트랙별 진행상황 SSOT** (점수·모델·엣지·신호·인프라·UI)
- [docs/history/](docs/history/) — **변천사 SSOT** (모델링·측정 / 서비스 / 지표 / 데이터흐름 4갈래 지도)

> **문서 갱신 규칙:** 트랙 종결/채택 → `docs/history/modeling-history.md` · 지표 변경 → `docs/score_roadmap.md` · 기능 마일스톤 → `docs/history/service-evolution.md` · 파이프라인 구조 변경 → `docs/data_flow.md`. 현재상태는 `docs/status/0N-*.md`.

- [docs/working_style.md](docs/working_style.md) — **시니어 개발자 + 설계자 관점, 협업 패턴**
- [docs/running_style_insight.md](docs/running_style_insight.md) — 주행 성향 분류 큰그림·현재 위치·다음 단계 (⑤⑥⑫ 완료 / ⑲ 스코어맵 종결 — 죽은코드, 로지스틱 직접학습)
- [docs/session_history.md](docs/session_history.md) — 세션별 작업 히스토리 (2026-06-02 ~ 현재)

### 할일
- [TODO.md](TODO.md) — 우선순위별 할일

---

## 📍 진행 상황 — 트랙별 (SSOT: docs/status/)

> 세션 인계·현재상태는 트랙 파일이 단일 출처. CLAUDE.md는 인덱스만.
> 시간순 전체 → [docs/session_history.md](docs/session_history.md) · 할일 → [TODO.md](TODO.md)

| 트랙 | 파일 | 현재 한 줄 |
|---|---|---|
| 점수·알고리즘 | [01-scoring](docs/status/01-scoring.md) | 로지스틱 직접학습 · ⑧ 부담중량 자문 대기 |
| 예측모델·벤치마크 | [02-model-benchmark](docs/status/02-model-benchmark.md) | 활성 id=7 v7-shape(전개 포함, 2022~ 학습) · benchmark 기간 플래그 |
| 시장엣지·전략 | [03-market-edge](docs/status/03-market-edge.md) | 선별표시·Platt 배포 · 공개피처 격파 종결 |
| 신호발굴 | [04-signals](docs/status/04-signals.md) | shape_signal 채택·v7 승격 완료 · class_move 채택 |
| 데이터인프라 | [05-data-infra](docs/status/05-data-infra.md) | DuckDB 미러 · egress 주의 · 조교 376k |
| UI·화면 | [06-ui](docs/status/06-ui.md) | 예상지 4열 · `/picks` 선별표시 |
