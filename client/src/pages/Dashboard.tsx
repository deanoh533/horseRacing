import { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, TrendingUp, ArrowRight, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

// ⚠️ Mock 데이터 (실제는 Supabase에서 가져옴)
const MOCK_WEIGHTS_TOP4 = [
  { id: '01_rating', name: '레이팅', value: 17.5 },
  { id: '09_jockey_form', name: '기수 폼', value: 10.5 },
  { id: '06_distance_fitness', name: '거리 적성', value: 8.8 },
  { id: '17_market_odds', name: '배당률', value: 8.8 },
];

const MOCK_RACES = [
  {
    meet: 1,
    rcNo: 1,
    time: '11:00',
    distance: 1300,
    grade: '6등급',
    horseCount: 10,
    top1: { chulNo: 1, hrName: '천리마', score: 88 },
    top2: { chulNo: 3, hrName: '황금날개', score: 82 },
    top3: { chulNo: 5, hrName: '바람이', score: 75 },
    darkHorse: { chulNo: 8, hrName: '노블윈드', score: 62, reason: '⑥ 거리적성 100%' },
    insight: '1-2위 박빙, 천리마는 거리·궁합 강점',
  },
  {
    meet: 1,
    rcNo: 2,
    time: '11:30',
    distance: 1400,
    grade: '5등급',
    horseCount: 11,
    top1: { chulNo: 3, hrName: '황금날개', score: 92 },
    top2: { chulNo: 7, hrName: '강철심장', score: 85 },
    top3: { chulNo: 1, hrName: '천리마', score: 78 },
    darkHorse: { chulNo: 11, hrName: '폭풍', score: 55, reason: '최근 5경주 급상승!' },
    insight: '황금날개 압도적, 안정적 1위 후보',
  },
];

export function Dashboard() {
  const [date, setDate] = useState(new Date('2026-05-22'));

  const formatDate = (d: Date) => {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
  };

  const changeDate = (offset: number) => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + offset);
    setDate(newDate);
  };

  return (
    <div className="space-y-6">
      {/* 날짜 선택 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => changeDate(-1)}
          className="p-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors"
          aria-label="이전 날짜"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-surface)] rounded-lg">
          <Calendar className="w-4 h-4 text-[var(--color-accent-cyan)]" />
          <span className="font-medium font-mono-num">{formatDate(date)}</span>
        </div>
        <button
          onClick={() => changeDate(1)}
          className="p-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors"
          aria-label="다음 날짜"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => setDate(new Date())}
          className="ml-2 px-3 py-1.5 text-xs bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors"
        >
          오늘
        </button>
      </div>

      {/* 핵심 가중치 4개 */}
      <section className="bg-[var(--color-bg-surface)] rounded-xl p-5 border border-[var(--color-bg-elevated)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span className="text-[var(--color-accent-gold)]">⭐</span>
            현재 적용 가중치 (상위 4)
          </h2>
          <button className="text-xs text-[var(--color-accent-cyan)] hover:underline flex items-center gap-1">
            17개 전체 보기
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {MOCK_WEIGHTS_TOP4.map((w) => (
            <div
              key={w.id}
              className="bg-[var(--color-bg-elevated)] rounded-lg p-3 border border-transparent hover:border-[var(--color-accent-cyan)] transition-colors"
            >
              <div className="text-xs text-[var(--color-text-secondary)]">{w.name}</div>
              <div className="text-2xl font-bold font-mono-num text-[var(--color-accent-cyan)] mt-1">
                {w.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 경마장: 서울 */}
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span>🏟️</span>
          서울 경마 (2경주)
        </h2>
        <div className="space-y-3">
          {MOCK_RACES.map((race) => (
            <RaceCard key={`${race.meet}-${race.rcNo}`} race={race} date={date} />
          ))}
        </div>
      </section>

      {/* 안내 */}
      <div className="text-center text-xs text-[var(--color-text-disabled)] py-4 border-t border-[var(--color-bg-elevated)]">
        ⚠️ Mock 데이터입니다. 실제 동기화 후 KRA 데이터로 교체됩니다.
      </div>
    </div>
  );
}

interface RaceCardProps {
  race: typeof MOCK_RACES[number];
  date: Date;
}

function RaceCard({ race, date }: RaceCardProps) {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return (
    <Link
      to={`/race/${race.meet}/${dateStr}/${race.rcNo}`}
      className="block bg-[var(--color-bg-surface)] rounded-xl p-4 border border-[var(--color-bg-elevated)] hover:border-[var(--color-accent-cyan)] transition-all group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-bold text-[var(--color-accent-cyan)]">{race.rcNo}R</span>
          <span className="font-mono-num text-[var(--color-text-secondary)]">{race.time}</span>
          <span className="text-[var(--color-text-secondary)]">|</span>
          <span className="font-mono-num">{race.distance}m</span>
          <span className="text-[var(--color-text-secondary)]">{race.grade}</span>
          <span className="text-xs text-[var(--color-text-disabled)]">{race.horseCount}마</span>
        </div>
        <ArrowRight className="w-4 h-4 text-[var(--color-text-disabled)] group-hover:text-[var(--color-accent-cyan)] transition-colors" />
      </div>

      {/* 1-3위 */}
      <div className="grid grid-cols-3 gap-2 mb-3 font-mono-num text-sm">
        <PredictionTile rank={1} chulNo={race.top1.chulNo} hrName={race.top1.hrName} score={race.top1.score} />
        <PredictionTile rank={2} chulNo={race.top2.chulNo} hrName={race.top2.hrName} score={race.top2.score} />
        <PredictionTile rank={3} chulNo={race.top3.chulNo} hrName={race.top3.hrName} score={race.top3.score} />
      </div>

      {/* 복병마 */}
      <div className="flex items-start gap-2 px-3 py-2 bg-[var(--color-bg-elevated)] rounded-lg mb-2">
        <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
        <div className="text-xs">
          <span className="text-[var(--color-warning)] font-semibold">복병:</span>{' '}
          <span className="font-mono-num">{race.darkHorse.chulNo}번 {race.darkHorse.hrName}</span>{' '}
          <span className="text-[var(--color-text-secondary)]">
            ({race.darkHorse.score}%, {race.darkHorse.reason})
          </span>
        </div>
      </div>

      {/* AI 인사이트 */}
      <div className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
        <TrendingUp className="w-4 h-4 text-[var(--color-accent-pink)] flex-shrink-0 mt-0.5" />
        <span>{race.insight}</span>
      </div>
    </Link>
  );
}

interface PredictionTileProps {
  rank: 1 | 2 | 3;
  chulNo: number;
  hrName: string;
  score: number;
}

function PredictionTile({ rank, chulNo, hrName, score }: PredictionTileProps) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const colors = {
    1: 'text-[var(--color-accent-gold)] border-[var(--color-accent-gold)]',
    2: 'text-[var(--color-text-primary)] border-[var(--color-text-disabled)]',
    3: 'text-[var(--color-text-secondary)] border-[var(--color-text-disabled)]',
  };
  return (
    <div className={`flex flex-col items-center justify-center p-2 rounded border ${colors[rank]} bg-[var(--color-bg-primary)]/50`}>
      <div className="text-lg leading-none">{medals[rank]}</div>
      <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">{chulNo}번</div>
      <div className="font-semibold truncate w-full text-center">{hrName}</div>
      <div className="text-xs text-[var(--color-accent-cyan)] mt-0.5">{score}%</div>
    </div>
  );
}
