# 🏆 KRA 경마 분석 도구 - PRD Overview

**서비스명:** KRA Analyzer (개인 분석 도구)
**사용자:** 본인 1명 (5년차 경마 분석가)
**목적:** 적중률 향상 → 수익 증대
**최종 업데이트:** 2026-05-22
**버전:** v5.0 (분리 문서 구조로 재편)

---

## 📁 문서 구조

```
docs/
├── PRD_overview.md             ← 현재 문서 (전체 개요)
├── score_items/                ← 14개 점수 항목 (개별 파일)
│   ├── 01_rating.md
│   ├── 02_recent_form/         ← 컨디션 (4개 신호)
│   │   ├── _overview.md
│   │   ├── signal_1_weight.md
│   │   ├── signal_2_form.md
│   │   ├── signal_3_time.md
│   │   └── signal_4_late.md
│   ├── 03_distance_fitness.md
│   ├── 04_track_adaptation.md
│   ├── 05_weight.md
│   ├── 06_jockey_form.md
│   ├── 07_trainer_form.md
│   ├── 08_race_interval.md
│   ├── 09_starting_position.md
│   ├── 10_age_distance_gender.md
│   ├── 11_pedigree.md
│   ├── 12_seasonal_pattern.md
│   ├── 13_jockey_horse_chemistry.md
│   └── 14_market_odds.md
├── algorithms/                 ← 핵심 알고리즘 (예정)
│   ├── spearman_correlation.md
│   ├── weight_adjustment.md
│   └── backtest.md
└── _archive/                   ← 이전 버전 PRD 보관
```

---

## 🎯 핵심 정체성

```
이전 가정 (잘못된):
  ❌ 대중 서비스 (1,000명+ MAU)
  ❌ 가상 페르소나 (박정수, 김다영)
  ❌ NPS, 유료 전환율

실제 (확정):
  ✅ 개인 도구 (본인 1명)
  ✅ 5년차 경마 전문 분석가
  ✅ 적중률 → 수익 향상이 진짜 KPI
```

## 🏗️ 기술 스택

```
프론트엔드: React + Vite + Tailwind CSS (다크모드)
백엔드: Vercel Serverless Functions
DB: Supabase PostgreSQL (500MB 무료)
인증: Supabase Auth (이메일, 본인만)
AI: Claude API (경주 인사이트 자동 생성)
배포: Vercel (완전 무료)
```

## 📊 14개 점수 항목 (총 100점)

| # | 항목 | 비중 | 상태 | 파일 |
|---|------|------|------|------|
| ① | 레이팅 | 20 | ✅ 확정 | [01_rating.md](score_items/01_rating.md) |
| ② | 컨디션 (최근 5경주) | 15 | ✅ 4개 신호 확정 | [02_recent_form/](score_items/02_recent_form/_overview.md) |
| ③ | 거리 적성 | 10 | ⏳ 의논 대기 | [03_distance_fitness.md](score_items/03_distance_fitness.md) |
| ④ | 주로 적응 | 10 | ⏳ 의논 대기 | [04_track_adaptation.md](score_items/04_track_adaptation.md) |
| ⑤ | 부담중량/마체중 | 5 | ⏸ 전문가 자문 | [05_weight.md](score_items/05_weight.md) |
| ⑥ | 기수 폼 | 12 | ⏳ 의논 대기 ⭐ | [06_jockey_form.md](score_items/06_jockey_form.md) |
| ⑦ | 조교사 폼 | 8 | ⏳ 의논 대기 | [07_trainer_form.md](score_items/07_trainer_form.md) |
| ⑧ | 경주 간격 | 4 | ✅ 확정 | [08_race_interval.md](score_items/08_race_interval.md) |
| ⑨ | 출발번호 (stOrd) | 3 | ✅ 확정 | [09_starting_position.md](score_items/09_starting_position.md) |
| ⑩ | 나이×거리×성별 | 3 | ⏸ 전문가 자문 | [10_age_distance_gender.md](score_items/10_age_distance_gender.md) |
| ⑪ | 혈통 (3대) | 5 | ⏸ 전문가 자문 | [11_pedigree.md](score_items/11_pedigree.md) |
| ⑫ | 계절 패턴 | 5 | ✅ 확정 | [12_seasonal_pattern.md](score_items/12_seasonal_pattern.md) |
| ⑬ | 기수-말 궁합 | 4 | ⏳ 의논 대기 ⭐ | [13_jockey_horse_chemistry.md](score_items/13_jockey_horse_chemistry.md) |
| ⑭ | 배당률(인기도) | 10 | ✅ 확정 | [14_market_odds.md](score_items/14_market_odds.md) |

**⭐ = 본인이 평소 중시하는 4대 핵심 분석 영역**

## 🔬 4대 핵심 분석 영역 (본인 노하우)

```
1. 컨디션 (말의 최근 5경주 추세) → 항목 ②
2. 거리 적성 → 항목 ③
3. 기수-말 궁합 → 항목 ⑬
4. 기수의 최근 성적 → 항목 ⑥
```

## 🧠 가중치 학습 - 하이브리드 시스템

```
초기: 본인이 5년 노하우로 가중치 설정
시스템: 백테스트로 "적정 가중치" 제안 (스피어만 상관계수)
결정: 본인이 보고 수동 조정 (수용 또는 무시)

→ 자세한 내용: algorithms/weight_adjustment.md (예정)
```

## 🔄 결과 처리 - 완전 자동

```
매일 새벽 KRA API 동기화
  → 실제 결과(ord) 자동 수집
  → 사용자 입력 부담 0
  → 어제 예측 vs 실제 자동 비교
```

## 🤖 AI 인사이트 (Claude API)

```
경주 인사이트 자동 생성:
  - "이번 경주는 박빙입니다"
  - "1번 마는 거리 적성이 결정적"
  - 매 경주마다 자동
```

## 📁 데이터 관리

```
✅ DB 저장 (모든 분석 이력)
✅ PDF 다운로드 (경마장 현장 출력용)
✅ 과거 분석 다시 조회 가능
```

## 🔌 검증된 KRA API (5개)

| API | Endpoint | 용도 |
|-----|----------|------|
| API214_1 | `/B551015/API214_1/RaceDetailResult_1` | 경주 결과 |
| API4_3 | `/B551015/API4_3/raceResult_3` | 경주 기록 (동일) |
| racedetailresult | `/B551015/racedetailresult/getracedetailresult` | stOrd 포함 |
| API284 | `/B551015/API284/HorseBloodBasicInfo` | 혈통 지수 |
| horseinfohi | `/B551015/horseinfohi/gethorseinfohi` | 부마/모마 |

## ⚠️ 알려진 KRA API 제약

```
🚨 hr_no 파라미터 필터링 안 됨
   → 모든 경주 데이터를 DB에 캐싱 필수
   → 매일 자동 동기화 + 클라이언트 측 필터링

🚨 ilsu 필드 ≠ 휴식일수
   → 직접 계산 (rcDate 차이)

🚨 popularity 필드 없음
   → winOdds 정렬로 계산
```

## 📚 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-22 | 분리 문서 구조로 재편 (v5.0) |
| 2026-05-22 | 컨디션 4개 신호 알고리즘 확정 |
| 2026-05-22 | PRD v4.0 - PM 프레임워크 통합 (이후 잘못된 가정 발견) |
| 2026-05-22 | PRD v3.2 - Supabase + Vercel로 변경 |
| 2026-05-22 | PRD v3.1 - KRA API 검증 반영 |
| 2026-05 | PRD v3.0 - 기술 스택 확정 |
| 2026-04 | PRD v2.3 - 가중치 조정 로직 추가 |
| 2026-04 | PRD v1.0 - 모바일 Claude 초안 |

→ 이전 버전들은 [_archive/](_archive/) 폴더 참조

## 🎯 다음 작업 (Roadmap)

### 다음 세션 의논 필요
- [ ] ③ 거리 적성 - 5년 노하우 반영
- [ ] ④ 주로 적응 - 알고리즘 조정
- [ ] ⑥ 기수 폼 - 4대 핵심 영역 (중요)
- [ ] ⑦ 조교사 폼
- [ ] ⑬ 기수-말 궁합 - 4대 핵심 영역 (중요)

### Phase 1: 코딩 시작
- [ ] Node.js + TypeScript 프로젝트 셋업
- [ ] Supabase 프로젝트 생성
- [ ] KRA API 클라이언트 구현
- [ ] DB 스키마 적용 (Setup_Guide.md 참조)
- [ ] Score Engine - 확정된 항목부터 구현

### Phase 2: 백테스트 + 학습
- [ ] 과거 2년 데이터 일괄 수집
- [ ] 스피어만 상관계수 계산
- [ ] 하이브리드 가중치 시스템

### Phase 3: UI/UX (다크모드)
- [ ] 대시보드
- [ ] 경주 분석 화면 (4대 핵심 강조)
- [ ] 컨디션 분석 패널 (4신호 시각화)
- [ ] PDF 리포트

### Phase 4: AI 인사이트
- [ ] Claude API 통합
- [ ] 경주별 자동 인사이트 생성
