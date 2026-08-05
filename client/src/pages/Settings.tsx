import { useState } from 'react';
import { RefreshCw, Brain, Cpu, KeyRound, ExternalLink, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useActiveModelVersion, useSyncStatus } from '../lib/queries';
import { ymdToDisplay } from '../lib/week';

// 수동 실행 보조 링크 — GitHub Actions Run workflow 페이지 (실행은 /api/sync 함수가 대리)
const ACTIONS_URL = 'https://github.com/deanoh533/horseRacing/actions/workflows/sync.yml';

export function Settings() {
  const { data: model, isLoading: modelLoading } = useActiveModelVersion();
  const { data: sync } = useSyncStatus();

  const [syncKey, setSyncKey] = useState(() => localStorage.getItem('kra_sync_key') ?? '');
  const [syncMsg, setSyncMsg] = useState<{ tone: 'ok' | 'err' | 'run'; text: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const saveKey = (v: string) => {
    setSyncKey(v);
    localStorage.setItem('kra_sync_key', v);
  };

  const runSync = async (target: 'racecard' | 'results') => {
    if (!syncKey.trim()) {
      setSyncMsg({ tone: 'err', text: '먼저 암구호를 입력하세요.' });
      return;
    }
    setRunning(target);
    setSyncMsg({ tone: 'run', text: '실행 요청 중…' });
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-key': syncKey.trim() },
        body: JSON.stringify({ target }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setSyncMsg({
          tone: 'ok',
          text: `✅ ${target === 'racecard' ? '출마표' : '결과'} 실행 시작됨 — 1~2분 뒤 반영.`,
        });
      } else {
        setSyncMsg({ tone: 'err', text: `❌ 실패: ${data.error ?? res.status}` });
      }
    } catch (e) {
      setSyncMsg({ tone: 'err', text: `❌ 네트워크 오류: ${(e as Error).message}` });
    } finally {
      setRunning(null);
    }
  };

  const itemCount = model?.weights ? Object.keys(model.weights).length : null;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">⚙️ 설정 · 시스템 현황</h1>

      {/* 활성 모델 */}
      <Section title="활성 모델" icon={<Cpu className="w-4 h-4 text-[var(--color-accent-cyan)]" />}>
        {modelLoading ? (
          <div className="text-sm text-[var(--color-text-secondary)]">모델 로딩 중…</div>
        ) : model ? (
          <div className="space-y-1.5">
            <Row label="모델" value={`${model.label} (id=${model.id})`} />
            <Row label="학습 소스" value={model.source} />
            {itemCount != null && <Row label="항목 수" value={`${itemCount}개`} />}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link
                to="/versions"
                className="px-3 py-1.5 bg-[var(--color-bg-elevated)] rounded hover:text-[var(--color-accent-cyan)] transition-colors"
              >
                버전 비교 →
              </Link>
              <Link
                to="/insights"
                className="px-3 py-1.5 bg-[var(--color-bg-elevated)] rounded hover:text-[var(--color-accent-cyan)] transition-colors"
              >
                인사이트 →
              </Link>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[var(--color-text-secondary)]">
            활성 모델 없음 (마이그레이션 확인 필요)
          </div>
        )}
      </Section>

      {/* 데이터 동기화 */}
      <Section
        title="데이터 동기화"
        icon={<RefreshCw className="w-4 h-4 text-[var(--color-accent-cyan)]" />}
      >
        <div className="space-y-1.5 text-sm">
          <Row label="최신 출마표 경주일" value={ymdToDisplay(sync?.latestCardDate)} />
          <Row
            label="누적 경주 수"
            value={sync ? `${sync.raceCount.toLocaleString()} 경주` : '—'}
          />
          <Row label="결과 기록된 최신 경주일" value={ymdToDisplay(sync?.latestResultDate)} />
          <Row
            label="마지막 출마표 수집"
            value={sync?.lastFetchedAt ? new Date(sync.lastFetchedAt).toLocaleString('ko-KR') : '—'}
          />
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-bg-elevated)]">
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
            자동 스케줄 (무인 cron)
          </h3>
          <ul className="text-xs text-[var(--color-text-secondary)] space-y-1 list-disc pl-4">
            <li>출마표 — 수·목·금 15:00 KST (주말 금·토·일 3일치)</li>
            <li>결과 — 금·토·일 19:00 KST (경주 당일 저녁)</li>
          </ul>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-bg-elevated)]">
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">수동 실행</h3>
          <div className="mb-2">
            <input
              type="password"
              value={syncKey}
              onChange={(e) => saveKey(e.target.value)}
              placeholder="암구호 (SYNC_SECRET)"
              className="w-full bg-[var(--color-bg-elevated)] px-3 py-2 rounded text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => runSync('racecard')}
              disabled={running !== null}
              className="px-3 py-2 text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors disabled:opacity-50"
            >
              출마표 실행
            </button>
            <button
              onClick={() => runSync('results')}
              disabled={running !== null}
              className="px-3 py-2 text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors disabled:opacity-50"
            >
              결과 실행
            </button>
            <a
              href={ACTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-cyan)] rounded transition-colors"
            >
              Actions에서 보기 <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {syncMsg && (
            <div
              className={`mt-2 text-xs ${
                syncMsg.tone === 'ok'
                  ? 'text-[var(--color-success)]'
                  : syncMsg.tone === 'err'
                    ? 'text-[var(--color-danger)]'
                    : 'text-[var(--color-text-secondary)]'
              }`}
            >
              {syncMsg.text}
            </div>
          )}
          <div className="mt-2 px-3 py-2 bg-[var(--color-bg-elevated)] rounded flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
            <Info className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
            <span>
              암구호는 이 브라우저에만 저장됩니다. 실행은 GitHub Actions에서 진행되며 결과는 수 분 내
              반영. <strong>로컬 dev 서버에선 동작하지 않고 배포본에서만</strong> 작동합니다.
            </span>
          </div>
        </div>
      </Section>

      {/* 가중치 학습 */}
      <Section title="가중치 학습" icon={<Brain className="w-4 h-4 text-[var(--color-accent-gold)]" />}>
        <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
          <p>
            <strong className="text-white">재학습 동결.</strong> v7-shape 라이브 성적 1개 분기(~12주)
            누적 + <code>probe:v7-accuracy</code> 첫 판정까지 재학습·승격 동결.
          </p>
          <p>
            이후 분기 1회 <strong className="text-white">수동</strong> 사이클: db:snapshot →
            learn:candidate → benchmark → promote. 자동 재학습 없음.
          </p>
        </div>
        <div className="mt-3 text-xs">
          <Link
            to="/versions"
            className="px-3 py-1.5 bg-[var(--color-bg-elevated)] rounded hover:text-[var(--color-accent-cyan)] transition-colors"
          >
            버전 비교 →
          </Link>
        </div>
      </Section>

      {/* 자격증명 관리 */}
      <Section
        title="자격증명 관리"
        icon={<KeyRound className="w-4 h-4 text-[var(--color-text-secondary)]" />}
      >
        <div className="px-3 py-2 bg-[var(--color-bg-elevated)] rounded flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
          <Info className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
          <span>
            KRA API 키·Supabase 자격증명은 <strong>GitHub Secrets</strong> / 로컬 <code>.env</code> 에서
            관리합니다 (웹에서 편집 불가).
          </span>
        </div>
      </Section>

      {/* 푸터 */}
      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-4 pb-8">
        KRA Analyzer
        {model
          ? ` · 활성 모델 ${model.label}${itemCount != null ? ` (${itemCount}개 항목)` : ''}`
          : ''}
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
