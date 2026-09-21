/**
 * Lab.tsx — 섀도 실험실: 라이브 모델 vs 실험(섀도) 버전 예측을 같은 경주끼리 비교.
 * spec: docs/superpowers/specs/2026-09-18-shadow-lab-design.md §6
 * (2026-09-18 옛 "판단항목 가중치 실험"을 교체 — 로지스틱 전환 후 무의미해져서)
 * 진입점: 헤더 "개인 도구" → /lab
 */
import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useLabData } from '../lib/queries';
import { buildScoreboard, buildRaceComparisons } from '../lib/labMetrics';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ymd = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400_000));
import { MEET_NAMES as MEET_NAME } from '../lib/meets';

type SourceFilter = 'all' | 'live' | 'backfill';

export function Lab() {
  const [range, setRange] = useState<{ from: number; to: number }>({ from: daysAgo(28), to: daysAgo(0) });
  const [source, setSource] = useState<SourceFilter>('all');
  const [meet, setMeet] = useState<0 | 1 | 3>(0);
  const [onlyDisagree, setOnlyDisagree] = useState(false);
  const { data, isLoading, error } = useLabData(range.from, range.to);

  const view = useMemo(() => {
    if (!data) return null;
    const active = data.versions.find((v) => v.is_active);
    if (!active) return null;
    const meetOk = (r: { meet: number }) => meet === 0 || r.meet === meet;
    const live = data.live.filter((r) => r.model_version === active.id && meetOk(r));
    const shadow = data.shadow.filter((r) => meetOk(r) && (source === 'all' || r.source === source));
    const label = new Map(data.versions.map((v) => [v.id, v.label]));
    return {
      active, label,
      board: buildScoreboard(live, shadow, active.id),
      races: buildRaceComparisons(live, shadow).filter((r) => !onlyDisagree || r.disagree),
    };
  }, [data, source, meet, onlyDisagree]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-[var(--color-accent-cyan)]" />
        <h1 className="text-lg font-bold">실험실 — 라이브 vs 실험 버전</h1>
      </header>

      <section className="flex flex-wrap gap-3 text-sm">
        <label>기간 <input type="number" value={range.from} onChange={(e) => setRange({ ...range, from: Number(e.target.value) })} className="w-28 bg-[var(--color-bg-elevated)] rounded px-2 py-1" />
          ~ <input type="number" value={range.to} onChange={(e) => setRange({ ...range, to: Number(e.target.value) })} className="w-28 bg-[var(--color-bg-elevated)] rounded px-2 py-1" /></label>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className="bg-[var(--color-bg-elevated)] rounded px-2 py-1">
          <option value="all">실험: 전체</option><option value="live">실험: 사전 저장만</option><option value="backfill">실험: 과거 채우기만</option>
        </select>
        <select value={meet} onChange={(e) => setMeet(Number(e.target.value) as 0 | 1 | 3)} className="bg-[var(--color-bg-elevated)] rounded px-2 py-1">
          <option value={0}>서울+부경</option><option value={1}>서울</option><option value={3}>부경</option>
        </select>
      </section>

      {isLoading && <p className="text-sm text-[var(--color-text-secondary)]">불러오는 중…</p>}
      {error && <p className="text-sm text-red-400">불러오기 실패: {(error as Error).message}</p>}
      {!isLoading && !error && data && !view && (
        <p className="text-sm text-[var(--color-text-secondary)]">활성 모델 버전이 없습니다.</p>
      )}
      {view && (
        <>
          <section className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[var(--color-text-secondary)]">
                <tr><th className="text-left py-1">버전</th><th>경주</th><th>단승</th><th>연승(1순위 3착내)</th><th>복승</th><th>TOP3 겹침</th></tr>
              </thead>
              <tbody>
                {view.board.map((r) => {
                  const isShadow = r.version !== view.active.id;
                  const empty = isShadow && r.races === 0;
                  return (
                    <tr key={r.version} className="border-t border-[var(--color-bg-elevated)] text-center">
                      <td className="text-left py-1">{view.label.get(r.version) ?? r.version}{r.version === view.active.id ? ' (라이브)' : ''}</td>
                      <td>{r.races}</td>
                      <td>{empty ? '—' : pct(r.win)}</td>
                      <td>
                        {empty ? '—' : pct(r.place)}
                        {!empty && r.placeDelta != null && (
                          <span className="ml-1 text-xs text-[var(--color-text-secondary)]">
                            ({r.placeDelta >= 0 ? '+' : ''}{(r.placeDelta * 100).toFixed(1)}%p, 운 범위 ±{((r.placeBand ?? 0) * 100).toFixed(1)}%p)
                          </span>
                        )}
                      </td>
                      <td>{empty ? '—' : pct(r.quinella)}</td>
                      <td>{empty ? '—' : r.top3Overlap.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              라이브 줄은 기간 내 전체 경주 기준, 실험 줄은 라이브와 겹치는 경주 기준이며 Δ는 겹치는 경주끼리 비교한 값입니다.
              차이가 "운 범위" 안이면 아직 실력 차라고 말할 수 없어요.
            </p>
          </section>

          <section>
            <label className="text-sm flex items-center gap-2 mb-2">
              <input type="checkbox" checked={onlyDisagree} onChange={(e) => setOnlyDisagree(e.target.checked)} /> 1순위가 엇갈린 경주만
            </label>
            <ul className="space-y-1 text-sm">
              {view.races.map((rc) => (
                <li key={rc.key} className="flex flex-wrap gap-x-4 border-t border-[var(--color-bg-elevated)] py-1">
                  <span className="w-36">{rc.race_date} {MEET_NAME[rc.meet] ?? rc.meet} {rc.rc_no}R</span>
                  {Object.entries(rc.picks).map(([v, p]) => (
                    <span key={v}>{view.label.get(Number(v)) ?? v}: {p.join('·')} {rc.placeHit[Number(v)] ? '✅' : ''}</span>
                  ))}
                  <span className="text-[var(--color-text-secondary)]">실제: {rc.actualTop3.join('·') || '결과 전'}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
