# KRA 경마 분석 도구 — Claude 컨텍스트

> 새 세션에서 이 파일을 가장 먼저 읽습니다.
> 마지막 업데이트: 2026-06-16 (시장격파 방법론 전환 — 공개 피처 발굴 종결)

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
- [docs/pipeline_guide.md](docs/pipeline_guide.md) — **파이프라인 실전 가이드**: 4개 데이터 소스 역할·라이브 예측 흐름·핵심 스크립트·전체 명령어. ⚠️ 새 스크립트·학습·검증 방법 추가 시 갱신
- [docs/data_flow.md](docs/data_flow.md) — **KRA API → DuckDB → ScoreEngine → Gate A/B → Benchmark → UI 전체 파이프라인** (2026-06-12 갱신)
- [docs/data_lifecycle.md](docs/data_lifecycle.md) — 출마표 발표·결과 도착 시점

### 알고리즘·예측
- [docs/score_algorithm.md](docs/score_algorithm.md) — 알고리즘 흐름 + **수정 가이드** (항목 목록·비중·산식은 roadmap·score_items 위임)
- [docs/score_roadmap.md](docs/score_roadmap.md) — **평가항목 고도화 로드맵** (클린 슬레이트 비교·변경 이력 Living Doc)
- [docs/prediction_mode.md](docs/prediction_mode.md) — 사전/사후 데이터 소스 차이
- [docs/accuracy_metrics.md](docs/accuracy_metrics.md) — **지표 관리 통합 문서**: 적중률 4개 지표 + Gate A/B 검증 표준 + 멀티모델 벤치마크 레이어. ⚠️ 새 검증/학습 방법 추가 시 이 문서도 갱신

### 화면·기능
- [docs/PRD_v6.1_entries_view.md](docs/PRD_v6.1_entries_view.md) — 출마정보 화면 PRD
- [docs/PRD_v6.1_race_info_legend.md](docs/PRD_v6.1_race_info_legend.md) — 에이스경마 1-34번 매핑

> **UI 현황 (2026-05-31):** 예상지 = 모바일 2+2 그리드 / 데스크탑 4열(`grid-cols-2 md:[grid-template-columns:2fr_1.2fr_3fr_2fr]`). 아코디언 레이아웃 미사용(사용자 확인). Col5Items = 가중치 상위 5개 동적 표시. RaceInfoBlock 공통 헤더(3개 화면 공유), 조교 이력 추가 완료. 대시보드 개발 용어 제거·모바일 버튼 개선 완료. **로딩 스켈레톤(U-001) 완료** — Loader2 스피너 → 4열 HorseCardSkeleton 8개. `lib/sectional.ts` 공통 유틸(getSectionalInfo·fmtSec·computeSameDistStats) 분리 완료. RaceEntries JockeyPanel(조합이력·최근3개월폼)·HorsePanel(구간기록·같은거리기록·조교·진료) 개선 완료.
>
> **HorseCard 컬럼 순서:** Col1=**마정보**(2fr) · Col2=**기수정보**(1.2fr) · Col3=**직전경주**(3fr) · Col4=**베팅조합**(2fr). skeleton·레이아웃 작업 시 혼동 주의.
>
> **구간기록 유틸:** `client/src/lib/sectional.ts` — `getSectionalInfo(entry)`, `fmtSec(t)`, `computeSameDistStats(history, dist)`. PredictionSheet·RaceEntries 공유. 페이지 파일에 재구현 금지.
>
> **training_logs 주의:** `st_time`/`sp_time`은 YYYYMMDDHHmmss 타임스탬프 (훈련 시작/종료 시각). 실제 소요시간은 `tr_term`(초). `pr_gubun` 범례: 이름=기수, 조=조교사, 관=주로조교, 생=교육생, 이름(트)=기수트랙라이더.

### 운영·디버깅
- [docs/api_spec.md](docs/api_spec.md) — **API 전체 명세 (SSOT)**: KRA 9개 엔드포인트·Supabase 스키마·React Query 훅·Claude API. ⚠️ **API 변경(엔드포인트·파라미터·필드·스키마) 시 이 문서를 함께 갱신**
- [docs/kra_api_quirks.md](docs/kra_api_quirks.md) — KRA API 컬럼명 함정
- [docs/troubleshooting.md](docs/troubleshooting.md) — 현재 발견된 의문·수정점
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 배포 메모

### 세션 인계 (새 세션 정독 추천)
- [docs/working_style.md](docs/working_style.md) — **시니어 개발자 + 설계자 관점, 협업 패턴**
- [docs/running_style_insight.md](docs/running_style_insight.md) — 주행 성향 분류 큰그림·현재 위치·다음 단계 (⑤⑥⑫⑲ 완료 / ⑲ 스코어맵 재설계 대기)
- [docs/session_history.md](docs/session_history.md) — 세션별 작업 히스토리 (2026-06-02 ~ 현재)

### 할일
- [TODO.md](TODO.md) — 우선순위별 할일

---

## ⚠️ 현재 실행 상태 (2026-06-12)

**브랜치:** `feat/duckdb-local-mirror` (main 미머지)  
**Supabase 제한:** 2026-06-23 리셋 (egress 소진 — 읽기·쓰기·웹앱 전부 차단)  
**활성 모델:** id=6 (v6-class-move, logistic) — DuckDB is_active 확인(2026-06-14). 벤치 연승 62.5% / 단승 30.6% / 시장 68.2%(−5.7%p)  
**DuckDB 스펙:** `docs/superpowers/specs/2026-06-12-duckdb-local-mirror-design.md`  
**Benchmark 스크립트:** `scripts/benchmark_all.ts` — `npm run benchmark`. **롤링 통합 완료(2026-06-14).**  
**롤링 통합 완료 (2026-06-14):** benchmark가 walkforward 흡수 → `walkforward_eval.ts` 삭제. 분기 확장윈도우 9모델 + 챔피언(model_versions) 대결 + 시장 깊은 진단(불일치·순위별·묶음). CLI `--gate-only`/`--no-gate`/`--champion <id>`. 코드 `src/engine/eval/`. 실측: 챔피언 롤링 연승 61.4%(시장 68.8%, −7.4%p). 스펙/플랜 `docs/superpowers/{specs,plans}/2026-06-14-rolling-benchmark-integration*`.

**▶ 2026-06-16 세션 인수인계 (다음 세션 여기부터):**
- **공개 피처 발굴 3건 음성으로 종결** — ① fade/복승 보조채택(게이트 Phase0서 후보0, 스펙/플랜 `2026-06-15-gate-aux-adoption*` CLOSED-null) ② ⑪ 긴요양 골짜기(91-180일 우승 5.7% 실재하나 헤드라인 불변, 되돌림) ③ ⑲ SCORE_MAP 교정(`b842c61`, 레거시용·라이브무관, Spearman 61.8→61.5 노이즈). 셋 다 **흡수 천장** 재확인.
- **⑲ 스코어맵 종결:** SCORE_MAP=죽은코드(라이브 로지스틱은 buildFeatures one-hot으로 직접학습). "재설계 대기" 아님 — 종결.
- **신규 산출물:** `docs/feature_hypotheses.md`(가설 카탈로그: 재도전7·현역재검2·탈락확정·메타패턴) + `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md`(방법론 전환 전략).
- **방향 전환:** "공개 피처 더 짜기" 중단 → 4갈래(서비스 캘리브레이션 / 반공개 신호 / 조건부 엣지 / Benter 2단계). 상세 [[project_market_edge_strategy]].
- **✅ 웹 검증 완료(2026-06-16):** 전략문서 ⚠️ 4항목 외부출처 확인. **반증 1건: KRA 엑조틱 공제율 26% > 단복승 20%** → 엑조틱이 오히려 더 어려움(A4(d) 하향). 나머지(공제율 높음·dirt-only·Benter 2단계 구조차이·draw 안쪽우위) 기존 서술 확증. 검증로그 = 전략문서 끝.

**브랜치 상태 (2026-06-12 세션 완료):**
- `gatherRaceInputs` / `predictRace` → `ReadClient` 추상화 완료 (`src/engine/scorePredictor.ts` 외 관련 파일)
- `scripts/benchmark_all.ts` 신규 (560줄): collectRaces → Gate A(상관계수) → Gate B(연승률 개선) → 9개 모델 학습 → 평가 → ASCII 리포트
- 스펙: `docs/superpowers/specs/2026-06-12-multi-model-benchmark-design.md`
- 플랜: `docs/superpowers/plans/2026-06-12-multi-model-benchmark.md`

**다음 단계 (우선순위 — 2026-06-16 갱신):**
1. **조교(training) 신호** — 본류. KRA 전체서비스 복구(**6/17 09:00**) 후 사용자가 `scripts/backfill_training.ts` 실행(쿼터벽=최근12개월 먼저) → 커버리지 → `npm run benchmark` 게이트A/B. 코드 Task1~6 완료(325테스트). [[project_training_signals]]
2. **방법론 전환 후보 (각각 구현 전 brainstorm)** — ✅완료: ~~조건부 엣지 마이닝~~(§C6, 채택후보 0) · ~~캘리브레이션 평가축~~(§C7) · ~~재보정 Platt/isotonic~~(`npm run calib:recal`, §C8, **✅ Platt이 P(1착) ECE 0.017→0.004 시장동률**·정직성만 따라잡음) · ~~적중률 7각도 천장검증~~(§C9, **전부 음성**: 거스르기·reach·깜짝마·깜짝마학습·카스케이드/블렌드·B단독·조건별강점(통제 안정성서 노이즈). 공개피처 천장 확정). **★다음 세션 1순위 = Benter 2단계(예측 정확도판)** — `a·log(시장확률)+b·log(모델확률)` 적합→OOS 합성vs시장. "모델이 시장 *위에* 직교정보 더하나"(미검증 유일). b>0이면 첫 돌파. 후속: ⓪ Platt 라이브 연결 · 조교 신호 · 마체중 직전수집. 상세 [[project_market_edge_strategy]] / `docs/strategy/2026-06-16-*` §C9.
3. ~~웹 검증 보강~~ **✅ 완료(2026-06-16)** — 전략문서 ⚠️ 4항목 외부출처 확인. **핵심 수정: KRA 엑조틱 공제율 26% > 단복승 20%** (엑조틱이 더 어려움, A4(d) 기대 하향). 공제율(단연 20/그외 26)·dirt-only·Benter 2단계 구조·draw편향(단거리 안쪽 35~38%) 확증. 검증로그 = `docs/strategy/2026-06-16-*` 문서 끝.
4. **model_versions 스키마 영구화** (6/23 이후) — `feature_schema`/`params` Supabase 반영 + 챔피언 artifact 저장.
5. **복승 배당 결손** — 2026-05-10~06-05 미수집 (6/23 이후 친구 키로 보충)

**롤백:** 이전 model_version id로 promote

> 세션별 상세 히스토리 → [docs/session_history.md](docs/session_history.md)

항목별 상태(완료/진행/ρ 값/개선 후보)는 아래 문서가 **단일 출처(SSOT)**입니다. 여기에 중복 기재하지 않습니다.

- **할일·우선순위** → [TODO.md](TODO.md) (P0~P3 + 런치 게이팅 + 의문 Q)
- **21항목 ρ·가중치·개선 상태** → [docs/score_roadmap.md](docs/score_roadmap.md) (Living Doc, §1 마스터 상태표)
- **의문·검토 중** → [docs/troubleshooting.md](docs/troubleshooting.md)

> 현재 최우선 개선 후보: ⑧ 부담중량 산식(ρ=0.316, 자문 대기). (⑲ 스코어맵은 2026-06-16 종결 — SCORE_MAP=죽은코드, 로지스틱이 직접학습) 상세는 위 문서 참조.

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
