import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, FileText, GitCompare, Save, TrendingUp, AlertCircle, Star, Bot } from 'lucide-react';

// ⚠️ Mock 데이터 (Supabase 연동 전)
const MOCK_HORSE = {
  chulNo: 1,
  hrName: '천리마',
  age: 3,
  sex: '거세마',
  origin: '한국',
  totalScore: 88,
  predictedRank: 1,
  winProbability: 45,

  // 기본 정보
  basicInfo: {
    wgBudam: 57,
    wgBudamAvg: 56,
    wgJk: 55,
    jockey: '조인권',
    wgHr: 463,
    wgHrDiff: 3,
    stOrd: 1,
    totalHorses: 10,
    rating: 95,
    trainer: '문현철',
    sire: '테스타마타',
    dam: '매그니피센트마인',
  },

  // 최근 5경주 이력
  recentRaces: [
    { date: '5/15', distance: 1300, track: '건조', ord: 1, wgHr: 460, jockey: '조인권' },
    { date: '5/01', distance: 1300, track: '양호', ord: 1, wgHr: 460, jockey: '조인권' },
    { date: '4/17', distance: 1400, track: '건조', ord: 2, wgHr: 458, jockey: '김어수' },
    { date: '4/03', distance: 1300, track: '건조', ord: 3, wgHr: 461, jockey: '조인권' },
    { date: '3/20', distance: 1200, track: '건조', ord: 3, wgHr: 459, jockey: '조인권' },
  ],
  formTrend: '점진 향상 (3-3-2-1-1)',

  // ⭐ 핵심 지표 4개 (자동 - 가중치 상위)
  coreIndicators: [
    {
      id: '01_rating',
      name: '레이팅',
      actualData: 'rating = 95',
      formula: '95 / 140 = 67.86%',
      pct: 95,
      weight: 17.54,
    },
    {
      id: '09_jockey_form',
      name: '기수 폼 (조인권)',
      actualData: '최근 30일 20번 출전, 1등 10번 / 입상 15번 (입상률 75%)',
      formula: '입상비율 0.75 + 1등보너스 0.10',
      pct: 100,
      weight: 10.53,
    },
    {
      id: '07_track_adaptation',
      name: '주로 적응 (건조)',
      actualData: '건조 5경주 평균 1.8위 (전체 평균 3.0위)',
      formula: '향상도 +1.2위',
      pct: 80,
      weight: 8.77,
    },
    {
      id: '06_distance_fitness',
      name: '거리 적성 (1300m)',
      actualData: '1300m 5번 출전: 1-1-1-2-2 (3승 + 2준우승)',
      formula: '차등 점수: 13/15',
      pct: 87,
      weight: 8.77,
    },
  ],

  // 🤖 인사이트 지표 4개 (수동 선택)
  insightIndicators: [
    {
      id: '03_recent_form',
      name: '착순 추세',
      actualData: '5경주: 3-3-2-1-1',
      pct: 92,
      aiInsight: '점진 향상 + 최근 2연승, 컨디션 매우 상승 중',
    },
    {
      id: '06_distance_fitness',
      name: '거리 적성',
      actualData: '1300m 5번 출전: 1-1-1-2-2',
      pct: 87,
      aiInsight: '1300m 절대 강자, 입상 100% 안정적',
    },
    {
      id: '09_jockey_form',
      name: '기수 폼',
      actualData: '조인권 30일 우승률 50%',
      pct: 100,
      aiInsight: '조인권 30일 우승률 상위 5%, 폼 매우 좋음',
    },
    {
      id: '16_jockey_horse_chemistry',
      name: '기수-말 궁합',
      actualData: '조인권-천리마 1년 4회 조합 (평균 1.5위, 말 평균 +1.0)',
      pct: 85,
      aiInsight: '환상의 콤비, 조인권과 만나면 우승 확률 ↑',
    },
  ],

  // 📊 나머지 9개 항목 (압축)
  otherItems: [
    { id: '02_weight_change', name: '마체중', data: '463kg (+3kg, 정상)', pct: 80 },
    { id: '04_sectional_time', name: '구간 시간', data: '전 경주 대비 0.3초 단축', pct: 75 },
    { id: '05_late_position', name: '후반 순위', data: '1펄롱 1위 → 마지막 1위 (선두 유지)', pct: 70 },
    { id: '08_burden_weight', name: '부담중량', data: '57kg (평균+1)', pct: 60 },
    { id: '10_trainer_form', name: '조교사', data: '문현철 60일 50번 출전, 입상 30번 (60%)', pct: 65 },
    { id: '11_race_interval', name: '경주 간격', data: '28일 (최적 28-35일)', pct: 100 },
    { id: '12_starting_position', name: '출발번호', data: '1번 + 단거리 1300m', pct: 95 },
    { id: '13_age_distance_gender', name: '나이/거리/성별', data: '3세 거세마 단거리', pct: 80 },
    { id: '14_pedigree', name: '혈통', data: '父 테스타마타 자손 1300m 70% 입상', pct: 70 },
    { id: '15_seasonal_pattern', name: '계절', data: '봄 1년 데이터 부족', pct: 60 },
    { id: '17_market_odds', name: '배당률', data: '최근 5경주 모두 1-2인기', pct: 100 },
  ],
};

export function HorseDetail() {
  const { meet, date, rcNo } = useParams();
  const horse = MOCK_HORSE;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <Link
        to={`/race/${meet}/${date}/${rcNo}`}
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-white"
      >
        <ChevronLeft className="w-4 h-4" />
        경주 상세로
      </Link>

      {/* 말 정보 + 종합 점수 */}
      <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 border border-[var(--color-bg-elevated)]">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-3xl">🐎</span>
              <h1 className="text-2xl font-bold">{horse.hrName}</h1>
            </div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              마번 {horse.chulNo} · {horse.age}세 {horse.sex} · {horse.origin}
            </div>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold font-mono-num text-[var(--color-accent-cyan)] glow-cyan">
              {horse.totalScore}<span className="text-lg">점</span>
            </div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">
              예측 {horse.predictedRank}위 · 1위 확률 {horse.winProbability}%
            </div>
          </div>
        </div>
      </div>

      {/* 기본 정보 */}
      <Section title="📊 기본 정보">
        <InfoGrid items={[
          { label: '나이/성별', value: `${horse.age}세 ${horse.sex} (${horse.origin})` },
          { label: '부담중량', value: `${horse.basicInfo.wgBudam}kg / 출전마 평균 ${horse.basicInfo.wgBudamAvg}kg (+${horse.basicInfo.wgBudam - horse.basicInfo.wgBudamAvg}kg)` },
          { label: '기수 체중', value: `${horse.basicInfo.wgJk}kg (${horse.basicInfo.jockey})` },
          { label: '마체중', value: `${horse.basicInfo.wgHr}kg (직전 +${horse.basicInfo.wgHrDiff}kg 증가)` },
          { label: '출발번호', value: `${horse.basicInfo.stOrd}번 (${horse.basicInfo.totalHorses}마 중)` },
          { label: '레이팅', value: `${horse.basicInfo.rating}` },
          { label: '조교사', value: `${horse.basicInfo.trainer}` },
          { label: '혈통', value: `父 ${horse.basicInfo.sire} / 母 ${horse.basicInfo.dam}` },
        ]} />
      </Section>

      {/* 최근 5경주 이력 */}
      <Section title="📈 최근 5경주 이력">
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm font-mono-num">
            <thead>
              <tr className="text-[var(--color-text-secondary)] text-xs">
                <th className="px-2 py-2 text-left">날짜</th>
                <th className="px-2 py-2 text-right">거리</th>
                <th className="px-2 py-2 text-left">주로</th>
                <th className="px-2 py-2 text-right">착순</th>
                <th className="px-2 py-2 text-right">마체중</th>
                <th className="px-2 py-2 text-left">기수</th>
              </tr>
            </thead>
            <tbody>
              {horse.recentRaces.map((race, i) => (
                <tr key={i} className="border-t border-[var(--color-bg-elevated)]">
                  <td className="px-2 py-2">{race.date}</td>
                  <td className="px-2 py-2 text-right">{race.distance}m</td>
                  <td className="px-2 py-2">{race.track}</td>
                  <td className="px-2 py-2 text-right font-semibold">
                    <span className={race.ord === 1 ? 'text-[var(--color-accent-gold)]' : race.ord <= 3 ? 'text-[var(--color-success)]' : ''}>
                      {race.ord}위
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">{race.wgHr}</td>
                  <td className="px-2 py-2">{race.jockey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-[var(--color-success)] flex items-center gap-1">
          <TrendingUp className="w-3.5 h-3.5" />
          {horse.formTrend}
        </div>
      </Section>

      {/* ⭐ 핵심 지표 4개 */}
      <Section
        title="⭐ 핵심 지표 4개"
        subtitle="가중치 상위 (자동)"
        accent="gold"
      >
        <div className="space-y-3">
          {horse.coreIndicators.map((item) => (
            <CoreIndicatorRow key={item.id} item={item} />
          ))}
        </div>
      </Section>

      {/* 🤖 인사이트 지표 4개 */}
      <Section
        title="🤖 인사이트 지표 4개"
        subtitle="사용자 선택 (AI 분석)"
        accent="pink"
      >
        <div className="space-y-3">
          {horse.insightIndicators.map((item) => (
            <InsightIndicatorRow key={item.id} item={item} />
          ))}
        </div>
      </Section>

      {/* 📊 나머지 9개 항목 */}
      <Section title="📊 나머지 항목">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {horse.otherItems.map((item) => (
            <OtherItemRow key={item.id} item={item} />
          ))}
        </div>
      </Section>

      {/* 액션 버튼 */}
      <div className="flex gap-2 pt-2">
        <ActionButton icon={<FileText className="w-3.5 h-3.5" />} label="이 말 PDF" />
        <ActionButton icon={<GitCompare className="w-3.5 h-3.5" />} label="비교 모드" />
        <ActionButton icon={<Save className="w-3.5 h-3.5" />} label="저장" />
      </div>

      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-2">
        ⚠️ Mock 데이터입니다.
      </div>
    </div>
  );
}

// ============================================
// 컴포넌트
// ============================================

function Section({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle?: string;
  accent?: 'gold' | 'pink';
  children: React.ReactNode;
}) {
  const accentColor =
    accent === 'gold'
      ? 'border-[var(--color-accent-gold)]/40'
      : accent === 'pink'
      ? 'border-[var(--color-accent-pink)]/40'
      : 'border-[var(--color-bg-elevated)]';

  return (
    <section className={`bg-[var(--color-bg-surface)] rounded-xl p-5 border ${accentColor}`}>
      <div className="flex items-end justify-between mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && (
          <span className="text-xs text-[var(--color-text-disabled)]">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function InfoGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-[var(--color-bg-elevated)] py-1">
          <dt className="text-[var(--color-text-secondary)] flex-shrink-0 min-w-[100px]">
            {item.label}
          </dt>
          <dd className="font-mono-num text-[var(--color-text-primary)] flex-1">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CoreIndicatorRow({ item }: { item: typeof MOCK_HORSE.coreIndicators[number] }) {
  return (
    <div className="border-l-2 border-[var(--color-accent-gold)] pl-3 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Star className="w-3.5 h-3.5 text-[var(--color-accent-gold)] fill-[var(--color-accent-gold)]" />
          <span>{item.name}</span>
          <span className="text-xs text-[var(--color-text-disabled)]">(가중치 {item.weight}점)</span>
        </div>
        <span className={`text-base font-bold font-mono-num ${item.pct >= 80 ? 'text-[var(--color-success)]' : 'text-[var(--color-accent-cyan)]'}`}>
          {item.pct}%
        </span>
      </div>
      <div className="text-xs text-[var(--color-text-secondary)] flex gap-2">
        <span className="text-[var(--color-text-disabled)]">📊</span>
        <span>{item.actualData}</span>
      </div>
      <div className="text-xs text-[var(--color-text-disabled)] font-mono-num">
        {item.formula}
      </div>
    </div>
  );
}

function InsightIndicatorRow({ item }: { item: typeof MOCK_HORSE.insightIndicators[number] }) {
  return (
    <div className="border-l-2 border-[var(--color-accent-pink)] pl-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Bot className="w-3.5 h-3.5 text-[var(--color-accent-pink)]" />
          <span>{item.name}</span>
        </div>
        <span className={`text-base font-bold font-mono-num ${item.pct >= 80 ? 'text-[var(--color-success)]' : 'text-[var(--color-accent-cyan)]'}`}>
          {item.pct}%
        </span>
      </div>
      <div className="text-xs text-[var(--color-text-secondary)]">
        <span className="text-[var(--color-text-disabled)]">📊</span> {item.actualData}
      </div>
      <div className="text-xs px-2 py-1.5 bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-secondary)] flex items-start gap-2">
        <AlertCircle className="w-3 h-3 text-[var(--color-accent-pink)] mt-0.5 flex-shrink-0" />
        <span>{item.aiInsight}</span>
      </div>
    </div>
  );
}

function OtherItemRow({ item }: { item: typeof MOCK_HORSE.otherItems[number] }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-[var(--color-bg-elevated)]">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[var(--color-text-secondary)]">{item.name}</div>
        <div className="text-xs font-mono-num text-[var(--color-text-primary)] truncate">{item.data}</div>
      </div>
      <span className={`text-sm font-mono-num font-semibold flex-shrink-0 ${item.pct >= 80 ? 'text-[var(--color-success)]' : item.pct >= 50 ? 'text-[var(--color-accent-cyan)]' : 'text-[var(--color-text-secondary)]'}`}>
        {item.pct}%
      </span>
    </div>
  );
}

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-bg-elevated)] transition-colors text-sm">
      {icon}
      <span>{label}</span>
    </button>
  );
}
