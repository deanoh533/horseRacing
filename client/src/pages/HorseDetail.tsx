import { useParams, Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function HorseDetail() {
  const { hrNo } = useParams();

  return (
    <div className="space-y-4">
      <Link
        to=".."
        relative="path"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-white"
      >
        <ChevronLeft className="w-4 h-4" />
        경주 상세
      </Link>

      <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 border border-[var(--color-bg-elevated)]">
        <h1 className="text-lg font-semibold mb-2">🐎 말 상세 - 마번 {hrNo}</h1>
        <p className="mt-4 text-xs text-[var(--color-text-disabled)]">
          🚧 17개 항목 + AI 인사이트 (UI/UX v3.0 화면 3) - 구현 예정
        </p>
      </div>
    </div>
  );
}
