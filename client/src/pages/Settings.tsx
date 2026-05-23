import { useState } from 'react';
import {
  Key,
  Bot,
  RefreshCw,
  Brain,
  Palette,
  Bell,
  Download,
  AlertTriangle,
  Info,
  Check,
} from 'lucide-react';

// ⚠️ Mock 데이터
const ALL_ITEMS = [
  { id: '01_rating', name: '레이팅' },
  { id: '02_weight_change', name: '마체중 변화' },
  { id: '03_recent_form', name: '착순 추세' },
  { id: '04_sectional_time', name: '구간 시간 단축' },
  { id: '05_late_position', name: '후반 구간 순위' },
  { id: '06_distance_fitness', name: '거리 적성' },
  { id: '07_track_adaptation', name: '주로 적응' },
  { id: '08_burden_weight', name: '부담중량' },
  { id: '09_jockey_form', name: '기수 폼' },
  { id: '10_trainer_form', name: '조교사 폼' },
  { id: '11_race_interval', name: '경주 간격' },
  { id: '12_starting_position', name: '출발번호' },
  { id: '13_age_distance_gender', name: '나이×거리×성별' },
  { id: '14_pedigree', name: '혈통' },
  { id: '15_seasonal_pattern', name: '계절 패턴' },
  { id: '16_jockey_horse_chemistry', name: '기수-말 궁합' },
  { id: '17_market_odds', name: '배당률' },
] as const;

const DEFAULT_INSIGHTS = [
  '03_recent_form',
  '06_distance_fitness',
  '09_jockey_form',
  '16_jockey_horse_chemistry',
];

export function Settings() {
  const [insightItems, setInsightItems] = useState<string[]>(DEFAULT_INSIGHTS);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [autoSync, setAutoSync] = useState(true);
  const [autoLearn, setAutoLearn] = useState(true);

  const toggleInsight = (id: string) => {
    setInsightItems((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 4) return prev; // 최대 4개
      return [...prev, id];
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">⚙️ 설정</h1>

      {/* KRA API */}
      <Section title="KRA API 설정" icon={<Key className="w-4 h-4 text-[var(--color-accent-cyan)]" />}>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-[var(--color-text-secondary)] mb-1">API 키</div>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value="••••••••••••••••••••"
                readOnly
                className="flex-1 bg-[var(--color-bg-elevated)] px-3 py-2 rounded text-sm font-mono-num"
              />
              <button className="px-3 py-2 text-xs bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors">
                편집
              </button>
              <button className="px-3 py-2 text-xs bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors">
                확인
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--color-success)]">
            <Check className="w-3.5 h-3.5" />
            정상 연결 (마지막 확인: 2026-05-22 09:30)
          </div>
        </div>
      </Section>

      {/* 인사이트 지표 4개 선택 */}
      <Section
        title="인사이트 지표 4개 (사용자 선택)"
        icon={<Bot className="w-4 h-4 text-[var(--color-accent-pink)]" />}
      >
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          AI 인사이트를 받을 17개 항목 중 4개 선택{' '}
          <span className="text-[var(--color-accent-cyan)]">({insightItems.length}/4)</span>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {ALL_ITEMS.map((item) => {
            const checked = insightItems.includes(item.id);
            const disabled = !checked && insightItems.length >= 4;
            return (
              <button
                key={item.id}
                onClick={() => toggleInsight(item.id)}
                disabled={disabled}
                className={`flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${
                  checked
                    ? 'bg-[var(--color-accent-pink)]/20 border border-[var(--color-accent-pink)] text-white'
                    : disabled
                    ? 'bg-[var(--color-bg-elevated)] border border-transparent opacity-50 cursor-not-allowed'
                    : 'bg-[var(--color-bg-elevated)] border border-transparent hover:border-[var(--color-accent-pink)]/50'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    checked
                      ? 'bg-[var(--color-accent-pink)] border-[var(--color-accent-pink)]'
                      : 'border-[var(--color-text-disabled)]'
                  }`}
                >
                  {checked && <Check className="w-3 h-3 text-black" strokeWidth={3} />}
                </span>
                {item.name}
              </button>
            );
          })}
        </div>

        <div className="mt-4 px-3 py-2 bg-[var(--color-bg-elevated)] rounded flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
          <Info className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
          <span>
            <strong>참고:</strong> ⭐ 핵심 지표 4개는 가중치 학습으로 자동 결정됩니다. 수동 변경 불가, 통계 화면에서 변화 추이 확인 가능.
          </span>
        </div>

        <button className="mt-4 w-full py-2 bg-[var(--color-accent-cyan)] text-black rounded font-semibold text-sm hover:bg-[var(--color-accent-cyan)]/80 transition-colors">
          💾 저장
        </button>
      </Section>

      {/* 데이터 동기화 */}
      <Section title="데이터 동기화" icon={<RefreshCw className="w-4 h-4 text-[var(--color-accent-cyan)]" />}>
        <div className="space-y-3 text-sm">
          <Row label="마지막 동기화" value="2026-05-22 03:00 (자동)" />
          <Row label="누적 데이터" value="2,247 경주" />
          <p className="text-xs text-[var(--color-text-secondary)]">→ 경주 결과(ord)도 자동 수집 (수동 입력 불필요)</p>
          <button className="px-4 py-2 bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded text-sm transition-colors">
            🔄 지금 동기화
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-bg-elevated)] space-y-2">
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">자동 동기화</h3>
          <Toggle checked={autoSync} onChange={setAutoSync} label="매일 새벽 3:00 자동 (KRA API)" />
          <Toggle checked={true} onChange={() => {}} label="경주 결과 자동 수집" />
        </div>
      </Section>

      {/* 가중치 학습 */}
      <Section title="가중치 학습" icon={<Brain className="w-4 h-4 text-[var(--color-accent-gold)]" />}>
        <Toggle checked={autoLearn} onChange={setAutoLearn} label="자동 학습 활성 (3개월마다)" />
        <div className="mt-3 text-sm text-[var(--color-text-secondary)]">
          다음 학습: <span className="font-mono-num text-white">2026-08-22</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button className="px-3 py-1.5 bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-elevated)]/80 rounded">
            ⚙️ 학습 설정
          </button>
          <button className="px-3 py-1.5 bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-elevated)]/80 rounded">
            📊 현재 가중치
          </button>
          <button className="px-3 py-1.5 bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-elevated)]/80 rounded">
            🔄 즉시 재학습
          </button>
        </div>
      </Section>

      {/* 외관 */}
      <Section title="외관" icon={<Palette className="w-4 h-4 text-[var(--color-accent-pink)]" />}>
        <Row
          label="테마"
          custom={
            <div className="flex gap-2">
              <RadioButton checked={theme === 'dark'} onChange={() => setTheme('dark')} label="다크" />
              <RadioButton checked={theme === 'light'} onChange={() => setTheme('light')} label="라이트" />
            </div>
          }
        />
        <Row
          label="언어"
          custom={<RadioButton checked label="한국어" onChange={() => {}} />}
        />
      </Section>

      {/* 알림 */}
      <Section title="알림" icon={<Bell className="w-4 h-4 text-[var(--color-warning)]" />}>
        <div className="space-y-2">
          <Toggle checked={true} onChange={() => {}} label="새 경주 일정 (전날 저녁)" />
          <Toggle checked={true} onChange={() => {}} label="가중치 학습 완료 (3개월마다)" />
          <Toggle checked={false} onChange={() => {}} label="경주 시작 30분 전" />
        </div>
      </Section>

      {/* 데이터 내보내기 */}
      <Section title="데이터 내보내기" icon={<Download className="w-4 h-4 text-[var(--color-text-secondary)]" />}>
        <div className="flex flex-wrap gap-2 text-sm">
          <ExportButton label="📥 전체 CSV" />
          <ExportButton label="📥 가중치 JSON" />
          <ExportButton label="📥 리포트 PDF" />
        </div>
      </Section>

      {/* 초기화 (위험) */}
      <Section title="초기화" icon={<AlertTriangle className="w-4 h-4 text-[var(--color-danger)]" />}>
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="px-4 py-2 bg-[var(--color-danger)]/20 hover:bg-[var(--color-danger)]/30 text-[var(--color-danger)] rounded border border-[var(--color-danger)]/50 transition-colors">
            ⚠️ 가중치 초기화
          </button>
          <button className="px-4 py-2 bg-[var(--color-danger)]/20 hover:bg-[var(--color-danger)]/30 text-[var(--color-danger)] rounded border border-[var(--color-danger)]/50 transition-colors">
            ⚠️ 모든 데이터 삭제
          </button>
        </div>
      </Section>

      {/* 버전 */}
      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-4 pb-8">
        KRA Analyzer v5.1 (17개 항목) · 최종 업데이트: 2026-05-22
      </div>
    </div>
  );
}

// ============================================
// 컴포넌트
// ============================================

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-[var(--color-bg-surface)] rounded-xl p-5 border border-[var(--color-bg-elevated)]">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, custom }: { label: string; value?: string; custom?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      {custom ?? <span className="font-mono-num">{value}</span>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 w-full text-left text-sm py-1 hover:text-[var(--color-accent-cyan)] transition-colors"
    >
      <span
        className={`w-9 h-5 rounded-full transition-colors relative ${
          checked ? 'bg-[var(--color-accent-cyan)]' : 'bg-[var(--color-bg-elevated)]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

function RadioButton({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onChange}
      className={`px-3 py-1.5 text-xs rounded transition-colors ${
        checked
          ? 'bg-[var(--color-accent-cyan)] text-black font-semibold'
          : 'bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-elevated)]/80'
      }`}
    >
      {label}
    </button>
  );
}

function ExportButton({ label }: { label: string }) {
  return (
    <button className="px-3 py-1.5 bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-elevated)]/80 rounded text-sm">
      {label}
    </button>
  );
}
