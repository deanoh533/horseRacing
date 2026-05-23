import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { ChevronLeft, FileText, Save, Settings as SettingsIcon, ChevronDown, Sparkles, Bot } from 'lucide-react';

// ⚠️ Mock 데이터 (Supabase 연동 전)
const MOCK_RACE = {
  meet: 1,
  meetName: '서울',
  date: '2026-05-22',
  rcNo: 1,
  distance: 1300,
  grade: '6등급',
  track: '건조',
  time: '11:00',
  totalHorses: 10,
  aiSummary: '1-2위 박빙. 천리마 거리·궁합 강점, 황금날개 기수폼 변수',
};

type ItemTag = 'star' | 'bot' | 'starbot';

interface DataItem {
  label: string;
  value: string;
  weightPct: number;
  weightItem: string; // ⑨, ⭐⑨ 등
  tag?: ItemTag;
}

interface HorseCardData {
  rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  chulNo: number;
  hrName: string;
  age: number;
  sex: '거' | '암' | '수';
  total: number;
  // 카테고리별 데이터
  weight: DataItem[];
  ability: DataItem[];
  recent: DataItem[];
  jockey: DataItem[];
  trainer: DataItem[];
  distance: DataItem[];
  chemistry: DataItem[];
}

const MOCK_HORSES: HorseCardData[] = [
  {
    rank: 1, chulNo: 1, hrName: '천리마', age: 3, sex: '거', total: 88,
    weight: [
      { label: '부담', value: '57kg (평균 56kg, +1)', weightPct: 60, weightItem: '⑧' },
      { label: '기수 체중', value: '55kg (조인권)', weightPct: 0, weightItem: '' },
      { label: '마체중', value: '463kg (+3kg)', weightPct: 80, weightItem: '②' },
    ],
    ability: [
      { label: '레이팅', value: '95', weightPct: 95, weightItem: '⑨', tag: 'star' },
      { label: '출발번호', value: '1번 (10마 중)', weightPct: 95, weightItem: '⑫' },
    ],
    recent: [
      { label: '최근 5경주 착순', value: '3-3-2-1-1 (점진 향상)', weightPct: 92, weightItem: '③', tag: 'bot' },
    ],
    jockey: [
      { label: '기수: 조인권 30일', value: '20번 (1등 10 / 입상 15 / 우승률 50%)', weightPct: 100, weightItem: '⑨', tag: 'starbot' },
    ],
    trainer: [
      { label: '조교사: 문현철 60일', value: '50번 (1등 15 / 입상 30 / 우승률 30%)', weightPct: 65, weightItem: '⑩' },
    ],
    distance: [
      { label: '거리 적성 1300m', value: '5번 출전: 1-1-1-2-2 (5번 입상 / 3번 1등)', weightPct: 87, weightItem: '⑥', tag: 'bot' },
    ],
    chemistry: [
      { label: '기수-말 궁합', value: '조인권-천리마 1년 4회 (평균 1.5위)', weightPct: 85, weightItem: '⑯', tag: 'bot' },
    ],
  },
  {
    rank: 2, chulNo: 3, hrName: '황금날개', age: 4, sex: '암', total: 82,
    weight: [
      { label: '부담', value: '56kg (평균 56kg, 0)', weightPct: 50, weightItem: '⑧' },
      { label: '기수 체중', value: '54kg (김어수)', weightPct: 0, weightItem: '' },
      { label: '마체중', value: '453kg (+4kg)', weightPct: 80, weightItem: '②' },
    ],
    ability: [
      { label: '레이팅', value: '85', weightPct: 85, weightItem: '⑨', tag: 'star' },
      { label: '출발번호', value: '3번', weightPct: 80, weightItem: '⑫' },
    ],
    recent: [
      { label: '최근 5경주 착순', value: '2-1-3-2-1', weightPct: 90, weightItem: '③', tag: 'bot' },
    ],
    jockey: [
      { label: '기수: 김어수 30일', value: '22번 (1등 6 / 입상 12 / 우승률 27%)', weightPct: 60, weightItem: '⑨', tag: 'starbot' },
    ],
    trainer: [
      { label: '조교사: 강형곤 60일', value: '45번 (1등 12 / 입상 28 / 우승률 27%)', weightPct: 70, weightItem: '⑩' },
    ],
    distance: [
      { label: '거리 적성 1300m', value: '4번 출전: 2-1-2-3 (4번 입상 / 1번 1등)', weightPct: 75, weightItem: '⑥', tag: 'bot' },
    ],
    chemistry: [
      { label: '기수-말 궁합', value: '김어수-황금날개 1년 2회 (평균 1.5위)', weightPct: 70, weightItem: '⑯', tag: 'bot' },
    ],
  },
  {
    rank: 3, chulNo: 5, hrName: '바람이', age: 5, sex: '수', total: 75,
    weight: [
      { label: '부담', value: '58kg (평균 56kg, +2)', weightPct: 40, weightItem: '⑧' },
      { label: '기수 체중', value: '56kg (전진구)', weightPct: 0, weightItem: '' },
      { label: '마체중', value: '475kg (-2kg)', weightPct: 70, weightItem: '②' },
    ],
    ability: [
      { label: '레이팅', value: '78', weightPct: 78, weightItem: '⑨', tag: 'star' },
      { label: '출발번호', value: '5번', weightPct: 60, weightItem: '⑫' },
    ],
    recent: [
      { label: '최근 5경주 착순', value: '5-3-4-2-3', weightPct: 60, weightItem: '③', tag: 'bot' },
    ],
    jockey: [
      { label: '기수: 전진구 30일', value: '18번 (1등 4 / 입상 10 / 우승률 22%)', weightPct: 55, weightItem: '⑨', tag: 'starbot' },
    ],
    trainer: [
      { label: '조교사: 이정상 60일', value: '40번 (1등 8 / 입상 20 / 우승률 20%)', weightPct: 50, weightItem: '⑩' },
    ],
    distance: [
      { label: '거리 적성 1300m', value: '3번 출전: 3-4-2', weightPct: 56, weightItem: '⑥', tag: 'bot' },
    ],
    chemistry: [
      { label: '기수-말 궁합', value: '전진구-바람이 1년 1회 (평균 3위)', weightPct: 50, weightItem: '⑯', tag: 'bot' },
    ],
  },
];

export function RaceDetail() {
  const { meet, date, rcNo } = useParams();
  const [showLowerRanks, setShowLowerRanks] = useState(false);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" />
          뒤로
        </Link>
        <span className="text-[var(--color-text-disabled)]">|</span>
        <span className="font-semibold">
          {MOCK_RACE.meetName} {MOCK_RACE.rcNo}R
        </span>
        <span className="font-mono-num">{MOCK_RACE.distance}m</span>
        <span className="text-[var(--color-text-secondary)]">{MOCK_RACE.grade}</span>
        <span>|</span>
        <span>{MOCK_RACE.track}</span>
        <span>|</span>
        <span className="font-mono-num">{MOCK_RACE.time}</span>
        <span className="text-[var(--color-text-disabled)]">{MOCK_RACE.totalHorses}마</span>
      </div>

      {/* AI 요약 */}
      <div className="bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)] flex items-start gap-3">
        <Bot className="w-5 h-5 text-[var(--color-accent-pink)] flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <span className="text-[var(--color-accent-pink)] font-semibold">AI 요약:</span>{' '}
          <span className="text-[var(--color-text-secondary)]">{MOCK_RACE.aiSummary}</span>
        </div>
      </div>

      {/* 출전마 카드 (상위 3 + 펼치기) */}
      <div className="space-y-3">
        {MOCK_HORSES.map((horse) => (
          <HorseCard key={horse.chulNo} horse={horse} meet={meet} date={date} rcNo={rcNo} />
        ))}
      </div>

      <button
        onClick={() => setShowLowerRanks(!showLowerRanks)}
        className="w-full py-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-cyan)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] rounded-xl border border-[var(--color-bg-elevated)] transition-colors flex items-center justify-center gap-1"
      >
        4-10위 펼치기
        <ChevronDown className={`w-4 h-4 transition-transform ${showLowerRanks ? 'rotate-180' : ''}`} />
      </button>

      {/* 범례 + 액션 */}
      <div className="flex items-center justify-between flex-wrap gap-3 pt-2 text-xs">
        <div className="text-[var(--color-text-secondary)]">
          <span className="text-[var(--color-accent-gold)]">⭐</span> = 핵심 (가중치 상위 4)
          <span className="mx-3">|</span>
          <span className="text-[var(--color-accent-pink)]">🤖</span> = AI 인사이트 (사용자 선택 4)
        </div>
        <div className="flex gap-2">
          <ActionButton icon={<FileText className="w-3.5 h-3.5" />} label="PDF" />
          <ActionButton icon={<Save className="w-3.5 h-3.5" />} label="저장" />
          <ActionButton icon={<SettingsIcon className="w-3.5 h-3.5" />} label="인사이트 변경" />
        </div>
      </div>

      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-2">
        ⚠️ Mock 데이터입니다. 실제 동기화 후 KRA 데이터로 교체됩니다.
      </div>
    </div>
  );
}

// ============================================
// 컴포넌트들
// ============================================

interface HorseCardProps {
  horse: HorseCardData;
  meet: string | undefined;
  date: string | undefined;
  rcNo: string | undefined;
}

function HorseCard({ horse, meet, date, rcNo }: HorseCardProps) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;
  const [showDetail, setShowDetail] = useState(true);

  return (
    <div className="bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-bg-elevated)] hover:border-[var(--color-accent-cyan)]/40 transition-colors overflow-hidden">
      {/* 상단: 순위 + 이름 + 점수 */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-bg-elevated)]">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{medals[horse.rank as 1 | 2 | 3] ?? horse.rank}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono-num text-[var(--color-text-secondary)] text-sm">{horse.chulNo}번</span>
              <span className="font-semibold text-base">{horse.hrName}</span>
              <span className="text-xs text-[var(--color-text-disabled)]">
                ({horse.age}세 {horse.sex})
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold font-mono-num text-[var(--color-accent-cyan)]">
            {horse.total}<span className="text-sm">점</span>
          </div>
          <div className="text-[10px] text-[var(--color-text-disabled)]">종합</div>
        </div>
      </div>

      {/* 데이터 카테고리들 */}
      {showDetail && (
        <div className="p-4 space-y-3">
          <DataCategory label="체중" items={horse.weight} />
          <DataCategory label="능력" items={horse.ability} />
          <DataCategory label="최근 5경주" items={horse.recent} />
          <DataCategory label="기수" items={horse.jockey} />
          <DataCategory label="조교사" items={horse.trainer} />
          <DataCategory label="거리" items={horse.distance} />
          <DataCategory label="궁합" items={horse.chemistry} />
        </div>
      )}

      {/* 하단 액션 */}
      <div className="px-4 py-2 flex items-center justify-between border-t border-[var(--color-bg-elevated)]">
        <button
          onClick={() => setShowDetail(!showDetail)}
          className="text-xs text-[var(--color-text-secondary)] hover:text-white flex items-center gap-1"
        >
          {showDetail ? '간략히' : '상세 보기'}
          <ChevronDown className={`w-3 h-3 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
        </button>
        <Link
          to={`/race/${meet}/${date}/${rcNo}/horse/${horse.chulNo}`}
          className="text-xs text-[var(--color-accent-cyan)] hover:underline flex items-center gap-1"
        >
          <Sparkles className="w-3 h-3" />
          말 상세 분석
        </Link>
      </div>
    </div>
  );
}

interface DataCategoryProps {
  label: string;
  items: DataItem[];
}

function DataCategory({ label, items }: DataCategoryProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent-cyan)] mb-1.5 font-semibold">
        [{label}]
      </div>
      <div className="space-y-1">
        {items.map((item, idx) => (
          <DataRow key={idx} item={item} />
        ))}
      </div>
    </div>
  );
}

function DataRow({ item }: { item: DataItem }) {
  const tag = item.tag;

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <span className="text-[var(--color-text-secondary)] flex-shrink-0">{item.label}:</span>
        <span className="font-mono-num text-[var(--color-text-primary)] truncate">{item.value}</span>
      </div>
      {item.weightPct > 0 && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {tag === 'star' && <span className="text-[var(--color-accent-gold)]">⭐</span>}
          {tag === 'bot' && <span className="text-[var(--color-accent-pink)]">🤖</span>}
          {tag === 'starbot' && (
            <>
              <span className="text-[var(--color-accent-gold)]">⭐</span>
              <span className="text-[var(--color-accent-pink)]">🤖</span>
            </>
          )}
          <span className="text-xs text-[var(--color-text-secondary)] font-mono-num">{item.weightItem}</span>
          <span
            className={`text-xs font-mono-num font-semibold tabular-nums w-12 text-right ${
              item.weightPct >= 80
                ? 'text-[var(--color-success)]'
                : item.weightPct >= 50
                  ? 'text-[var(--color-accent-cyan)]'
                  : 'text-[var(--color-text-secondary)]'
            }`}
          >
            {item.weightPct}%
          </span>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-bg-elevated)] transition-colors">
      {icon}
      <span>{label}</span>
    </button>
  );
}
