import { useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function RaceDetail() {
  const { meet, date, rcNo } = useParams();

  return (
    <div className="space-y-4">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-white"
      >
        <ChevronLeft className="w-4 h-4" />
        대시보드
      </Link>

      <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 border border-[var(--color-bg-elevated)]">
        <h1 className="text-lg font-semibold mb-2">경주 상세</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {meet === '1' ? '서울' : '부산경남'} | {date} | {rcNo}R
        </p>
        <p className="mt-4 text-xs text-[var(--color-text-disabled)]">
          🚧 출전마 한눈에 보기 (UI/UX v3.0 화면 2) - 구현 예정
        </p>
      </div>
    </div>
  );
}
