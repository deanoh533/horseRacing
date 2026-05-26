import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, FileText, GitCompare, Save, TrendingUp, Loader2, Star } from 'lucide-react';
import { useHorseHistory, useHorsesByRace, usePredictionsByRace } from '../lib/queries';
import { type RaceEntry, type ItemScore, formatActualOrd, isCancelled } from '../lib/supabase';
import { useMemo } from 'react';

export function HorseDetail() {
  const { meet: meetStr, date: dateStr, rcNo: rcNoStr, chulNo: chulNoStr } = useParams();
  const meet = Number(meetStr);
  const rcDate = Number(dateStr);
  const rcNo = Number(rcNoStr);
  const chulNo = Number(chulNoStr);

  const { data: horses, isLoading } = useHorsesByRace(rcDate, meet, rcNo);
  const horse = useMemo(
    () => horses?.find((h) => h.pthr_no === chulNo),
    [horses, chulNo]
  );

  const { data: history } = useHorseHistory(horse?.hr_name ?? '', rcDate, 5);
  const { data: predictions } = usePredictionsByRace(rcDate, meet, rcNo);
  const prediction = useMemo(
    () => predictions?.find((p) => p.hr_name === horse?.hr_name),
    [predictions, horse?.hr_name]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-secondary)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        로딩 중...
      </div>
    );
  }

  if (!horse) {
    return (
      <div className="space-y-4">
        <Link
          to={`/race/${meetStr}/${dateStr}/${rcNoStr}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" />
          경주 상세로
        </Link>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          ❌ 출전마 데이터 없음 (pthr_no={chulNo})
        </div>
      </div>
    );
  }

  const sexFull = sexToFull(horse.gndr);
  const recentSummary = history && history.length > 0 ? summarizeForm(history) : null;

  return (
    <div className="space-y-4">
      {/* 뒤로 */}
      <Link
        to={`/race/${meetStr}/${dateStr}/${rcNoStr}`}
        className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-white"
      >
        <ChevronLeft className="w-4 h-4" />
        경주 상세로
      </Link>

      {/* 말 정보 */}
      <div className="bg-[var(--color-bg-surface)] rounded-xl p-6 border border-[var(--color-bg-elevated)]">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-3xl">🐎</span>
              <h1 className="text-2xl font-bold">{horse.hr_name}</h1>
            </div>
            <div className="text-sm text-[var(--color-text-secondary)]">
              마번 {horse.pthr_no} · {horse.ag ?? '?'}세 {sexFull} · 마번호 {horse.hr_no}
            </div>
          </div>
          <div className="text-right">
            {prediction ? (
              <>
                <div className="text-4xl font-bold font-mono-num text-[var(--color-accent-cyan)] glow-cyan">
                  {prediction.total_score.toFixed(1)}
                  <span className="text-lg">점</span>
                </div>
                <div className="text-sm text-[var(--color-text-secondary)] mt-1">
                  예측 {prediction.predicted_rank}위
                  {isCancelled(horse.ord) ? (
                    <span className="text-[var(--color-accent-pink)]"> · 🚫 출주 취소</span>
                  ) : (
                    <span
                      className={
                        prediction.predicted_rank === horse.ord
                          ? ' text-[var(--color-success)] font-bold'
                          : ''
                      }
                    >
                      {' '}· 실제 {formatActualOrd(horse.ord)}
                      {prediction.predicted_rank === horse.ord ? ' ✓' : ''}
                    </span>
                  )}
                </div>
              </>
            ) : (
              horse.ratg != null && horse.ratg > 0 && (
                <div className="text-3xl font-bold font-mono-num text-[var(--color-accent-cyan)] glow-cyan">
                  {horse.ratg}
                  <span className="text-lg">레이팅</span>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* 기본 정보 */}
      <Section title="📊 기본 정보">
        <InfoGrid
          items={[
            { label: '나이/성별', value: `${horse.ag ?? '?'}세 ${sexFull}` },
            ...(horse.burd_wgt !== null
              ? [{ label: '부담중량', value: `${horse.burd_wgt}kg` }]
              : []),
            ...(horse.wg_jk != null && horse.wg_jk !== 0
              ? [{ label: '기수 체중', value: `${horse.wg_jk}kg` }]
              : []),
            ...(horse.wg_hr !== null
              ? [
                  {
                    label: '마체중',
                    value: `${horse.wg_hr}kg ${formatDiff(horse.wg_hr_diff)}`,
                  },
                ]
              : []),
            ...(horse.ratg != null && horse.ratg > 0
              ? [{ label: '레이팅', value: `${horse.ratg}` }]
              : []),
            ...(horse.jcky_nm
              ? [{ label: '기수', value: `${horse.jcky_nm} (${horse.jcky_no ?? '-'})` }]
              : []),
            ...(horse.trar_nm
              ? [{ label: '조교사', value: `${horse.trar_nm} (${horse.trar_no ?? '-'})` }]
              : []),
            ...(horse.win_odds !== null
              ? [{ label: '단승 배당', value: `${horse.win_odds}배` }]
              : []),
            ...(horse.rc_time !== null
              ? [{ label: '경주 기록', value: formatRcTime(horse.rc_time) }]
              : []),
          ]}
        />
      </Section>

      {/* 최근 N경주 이력 */}
      <Section title="📈 최근 경주 이력 (이전 5경주)">
        {!history && (
          <div className="text-xs text-[var(--color-text-disabled)] py-2">
            <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
            이력 로딩 중...
          </div>
        )}
        {history && history.length === 0 && (
          <div className="text-xs text-[var(--color-text-disabled)] py-2">
            과거 경주 이력 없음
          </div>
        )}
        {history && history.length > 0 && (
          <>
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
                  {history.map((race, i) => (
                    <tr
                      key={i}
                      className="border-t border-[var(--color-bg-elevated)]"
                    >
                      <td className="px-2 py-2">{formatDate(race.race_date)}</td>
                      <td className="px-2 py-2 text-right">
                        {race.rc_dist ?? '-'}m
                      </td>
                      <td className="px-2 py-2">{race.track_type ?? '-'}</td>
                      <td className="px-2 py-2 text-right font-semibold">
                        <span
                          className={
                            race.ord === 1
                              ? 'text-[var(--color-accent-gold)]'
                              : race.ord && race.ord <= 3
                                ? 'text-[var(--color-success)]'
                                : isCancelled(race.ord)
                                  ? 'text-[var(--color-accent-pink)] text-xs'
                                  : ''
                          }
                        >
                          {formatActualOrd(race.ord)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {race.wg_hr ?? '-'}
                      </td>
                      <td className="px-2 py-2">{race.jcky_nm ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {recentSummary && (
              <div className="mt-3 text-xs text-[var(--color-success)] flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" />
                {recentSummary}
              </div>
            )}
          </>
        )}
      </Section>

      {/* Score Engine 17개 항목 */}
      {prediction && <ItemScoresSection items={prediction.item_scores} />}

      {!prediction && (
        <Section title="⭐ 17개 항목 점수" subtitle="예측 데이터 없음">
          <div className="text-sm text-[var(--color-text-disabled)]">
            이 경주는 아직 점수 계산 전이에요 (`npm run backfill` 또는 다음 sync 시 생성)
          </div>
        </Section>
      )}

      {/* AI Insight placeholder */}
      <Section title="🤖 AI 인사이트" subtitle="Phase 2 예정">
        <div className="text-sm text-[var(--color-text-disabled)]">
          Claude API 연동 시 항목별 자연어 해석 추가 예정
        </div>
      </Section>

      {/* 액션 */}
      <div className="flex gap-2 pt-2">
        <ActionButton icon={<FileText className="w-3.5 h-3.5" />} label="이 말 PDF" />
        <ActionButton icon={<GitCompare className="w-3.5 h-3.5" />} label="비교 모드" />
        <ActionButton icon={<Save className="w-3.5 h-3.5" />} label="저장" />
      </div>
    </div>
  );
}

// ============================================
// 유틸 & 컴포넌트
// ============================================

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-[var(--color-bg-surface)] rounded-xl p-5 border border-[var(--color-bg-elevated)]">
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

function ItemScoresSection({ items }: { items: Record<string, ItemScore> }) {
  // weightedScore 내림차순 → 기여도 높은 순
  const sorted = useMemo(
    () => Object.values(items).sort((a, b) => b.weightedScore - a.weightedScore),
    [items]
  );
  const top4 = sorted.slice(0, 4); // ⭐ 핵심 4 (기여도 상위)
  const rest = sorted.slice(4);

  return (
    <Section title="⭐ 17개 항목 점수" subtitle="기여도 순">
      <div className="space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent-gold)] mb-2 font-semibold flex items-center gap-1">
            <Star className="w-3 h-3 fill-[var(--color-accent-gold)]" />
            핵심 기여 TOP 4
          </div>
          <div className="space-y-2">
            {top4.map((item) => (
              <ScoreRow key={item.itemId} item={item} highlight />
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-secondary)] mb-2 font-semibold">
            기타 항목
          </div>
          <div className="space-y-1">
            {rest.map((item) => (
              <ScoreRow key={item.itemId} item={item} highlight={false} />
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function ScoreRow({ item, highlight }: { item: ItemScore; highlight: boolean }) {
  const pct = Math.round(item.rawScore * 100);
  const isExpert = item.status === 'expert_pending';
  const barColor =
    pct >= 70
      ? 'bg-[var(--color-success)]'
      : pct >= 40
        ? 'bg-[var(--color-accent-cyan)]'
        : 'bg-[var(--color-text-disabled)]';
  return (
    <div
      className={`flex items-center gap-3 text-xs ${highlight ? 'py-1.5' : 'py-1'}`}
    >
      <div
        className={`flex-1 min-w-0 ${highlight ? 'font-medium text-sm' : 'text-[var(--color-text-secondary)]'}`}
      >
        {item.itemName}
        {isExpert && (
          <span className="ml-1 text-[9px] text-[var(--color-text-disabled)]">
            (전문가)
          </span>
        )}
      </div>
      <div className="w-24 h-1.5 bg-[var(--color-bg-elevated)] rounded overflow-hidden flex-shrink-0">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-10 text-right font-mono-num text-[var(--color-text-secondary)] flex-shrink-0">
        {pct}%
      </div>
      <div className="w-12 text-right font-mono-num text-[var(--color-accent-cyan)] flex-shrink-0">
        {item.weightedScore.toFixed(1)}점
      </div>
    </div>
  );
}

function InfoGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-start gap-3 border-b border-[var(--color-bg-elevated)] py-1"
        >
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

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-bg-elevated)] transition-colors text-sm">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function sexToFull(sex: string | null): string {
  if (!sex) return '';
  const map: Record<string, string> = { 거: '거세마', 암: '암말', 수: '수말' };
  return map[sex] ?? sex;
}

function formatDiff(diff: number | null): string {
  if (diff === null) return '';
  if (diff === 0) return '(0)';
  return `(${diff > 0 ? '+' : ''}${diff})`;
}

function formatDate(rcDate: number): string {
  const m = Math.floor((rcDate % 10000) / 100);
  const d = rcDate % 100;
  return `${m}/${String(d).padStart(2, '0')}`;
}

function formatRcTime(rcTime: number): string {
  const sec = rcTime / 10;
  const min = Math.floor(sec / 60);
  const rest = (sec - min * 60).toFixed(1);
  return min > 0 ? `${min}:${rest.padStart(4, '0')}` : `${rest}초`;
}

function summarizeForm(history: RaceEntry[]): string {
  const ords = history
    .map((h) => h.ord)
    .filter((o): o is number => o !== null);
  if (ords.length === 0) return '';
  const seq = [...ords].reverse().join('-');
  const avg = ords.reduce((s, o) => s + o, 0) / ords.length;
  const recent = ords[0];
  const trend =
    ords.length >= 3
      ? recent! < avg
        ? '향상 추세'
        : recent! > avg
          ? '하락 추세'
          : '안정 추세'
      : '';
  return `${seq} (평균 ${avg.toFixed(1)}위${trend ? ', ' + trend : ''})`;
}
