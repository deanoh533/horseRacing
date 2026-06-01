import { NavLink, Outlet, Link } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Settings as SettingsIcon, FlaskConical } from 'lucide-react';

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg-primary)] text-white">
      {/* 상단 헤더 */}
      <header className="border-b border-[var(--color-bg-elevated)] bg-[var(--color-bg-surface)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🏆</span>
            <span className="font-semibold tracking-tight">KRA Analyzer</span>
            <span className="text-xs text-[var(--color-text-disabled)]">v5.1</span>
          </div>
          <Link
            to="/lab"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-cyan)] hover:text-black transition-colors"
            title="판단항목 가중치 실험"
          >
            <FlaskConical className="w-4 h-4" />
            <span>실험실</span>
          </Link>
        </div>
      </header>

      {/* 메인 컨텐츠 영역 */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>

      {/* 하단 탭 네비게이션 (모바일) / 사이드바 대체 (데스크탑은 상단에 ) */}
      <nav className="border-t border-[var(--color-bg-elevated)] bg-[var(--color-bg-surface)] sticky bottom-0">
        <div className="max-w-7xl mx-auto px-2 h-14 flex items-center justify-around">
          <NavTab to="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label="대시보드" />
          <NavTab to="/stats" icon={<BarChart3 className="w-4 h-4" />} label="통계" />
          <NavTab to="/settings" icon={<SettingsIcon className="w-4 h-4" />} label="설정" />
        </div>
      </nav>
    </div>
  );
}

interface NavTabProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

function NavTab({ to, icon, label }: NavTabProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-1 px-4 py-2 transition-colors ${
          isActive
            ? 'text-[var(--color-accent-cyan)]'
            : 'text-[var(--color-text-secondary)] hover:text-white'
        }`
      }
    >
      {icon}
      <span className="text-[10px]">{label}</span>
    </NavLink>
  );
}
