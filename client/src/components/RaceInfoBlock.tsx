/**
 * RaceInfoBlock — 경주 상세 정보 카드 (공유 컴포넌트)
 *
 * AI예측 / 예상지 / 출마정보 3개 화면에서 공통 사용.
 * race 데이터 로드 전: 날짜·경마장·경주번호만 표시 (URL 파라미터 기반)
 * race 데이터 로드 후: 등급·상금·부담중량표·등급최고기록 추가 표시
 */

import { useMemo } from 'react';
import type { Race, RaceEntry } from '../lib/supabase';

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부경' };

// ── 유틸 ─────────────────────────────────────────────────────────────

function formatErng(v: number | null | undefined): string {
  if (v == null || v === 0) return '-';
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString()}만`;
  return String(v);
}

function formatRcTime(t: number | null | undefined): string {
  if (t == null || t === 0) return '-';
  const min = Math.floor(t / 60);
  const sec = (t % 60).toFixed(1);
  return min > 0 ? `${min}:${sec.padStart(4, '0')}` : sec;
}

function formatRcDate(d: number): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor((d % 10000) / 100);
  const day = d % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ── Props ─────────────────────────────────────────────────────────────

interface GradeStats {
  avg: number;
  best: number;
  count: number;
  avgBurdWgt: number | null;
}

interface RaceInfoBlockProps {
  /** URL 파라미터 — race 로드 전에도 항상 표시 */
  rcDate: number;
  meet: number;
  rcNo: number;
  /** races 테이블 데이터 (로드 후) */
  race?: Race | null;
  /** 출전마 목록 — 성별조건·레이팅범위·부담중량표 파생용 */
  horses?: RaceEntry[];
  /** 해당 등급/거리 우승마 기록 통계 */
  gradeStats?: GradeStats | null;
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────

export function RaceInfoBlock({
  rcDate,
  meet,
  rcNo,
  race,
  horses,
  gradeStats,
}: RaceInfoBlockProps) {
  // ── 출전마 데이터 파생 ────────────────────────────────────────────

  /** 성별 조건 (출전마 gndr 분포로 파생) */
  const sexCond = useMemo(() => {
    if (!horses?.length) return null;
    const genders = new Set(horses.map((h) => h.gndr).filter(Boolean));
    const hasFemale = genders.has('암');
    const hasMale = genders.has('수') || genders.has('거');
    if (hasFemale && hasMale) return '성별오픈';
    if (hasFemale) return '암마경주';
    if (hasMale) return '수컷경주';
    return null;
  }, [horses]);

  /** 레이팅 범위 (R최소~최대) */
  const ratingRange = useMemo(() => {
    if (!horses?.length) return null;
    const ratings = horses
      .map((h) => h.ratg)
      .filter((r): r is number => r != null && r > 0);
    if (ratings.length === 0) return null;
    return { min: Math.min(...ratings), max: Math.max(...ratings) };
  }, [horses]);

  /** 부담중량표: 연령×성별 → 중량 조합 */
  const weightTable = useMemo(() => {
    if (!horses?.length) return null;
    const seen = new Set<string>();
    type Entry = { agLabel: string; agOrder: number; gndrLabel: string; wgt: number };
    const entries: Entry[] = [];

    horses.forEach((h) => {
      if (h.burd_wgt == null || h.ag == null || !h.gndr) return;
      const agLabel = h.ag <= 2 ? '2세' : '3세이상';
      const agOrder = h.ag <= 2 ? 0 : 1;
      const gndrLabel = h.gndr === '암' ? '암' : '수·거';
      const key = `${agLabel}-${gndrLabel}-${h.burd_wgt}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ agLabel, agOrder, gndrLabel, wgt: h.burd_wgt });
      }
    });

    if (entries.length === 0) return null;

    entries.sort((a, b) => {
      if (a.agOrder !== b.agOrder) return a.agOrder - b.agOrder;
      return a.gndrLabel === '암' ? -1 : 1;
    });

    // 연령 그룹으로 묶어서 표시
    const byAge = new Map<string, { gndrLabel: string; wgt: number }[]>();
    entries.forEach((e) => {
      const arr = byAge.get(e.agLabel) ?? [];
      arr.push({ gndrLabel: e.gndrLabel, wgt: e.wgt });
      byAge.set(e.agLabel, arr);
    });

    return [...byAge.entries()]
      .map(([ag, items]) => {
        const parts = items.map((i) => `${i.gndrLabel} ${i.wgt}kg`).join(', ');
        return `${ag}(${parts})`;
      })
      .join(' · ');
  }, [horses]);

  // ── 렌더 ─────────────────────────────────────────────────────────

  const hasPrize = race?.chaksun1 || race?.chaksun2 || race?.chaksun3;
  const prizeList = [
    race?.chaksun1 && `1위 ${formatErng(race.chaksun1)}`,
    race?.chaksun2 && `2위 ${formatErng(race.chaksun2)}`,
    race?.chaksun3 && `3위 ${formatErng(race.chaksun3)}`,
  ].filter(Boolean);

  return (
    <div
      className="rounded-xl p-4 space-y-2"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-bg-elevated)' }}
    >
      {/* ① 기본 경주 정보 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono-num text-sm" style={{ color: 'var(--color-text-disabled)' }}>
          {formatRcDate(rcDate)}
        </span>
        <span className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {MEET_NAMES[meet] ?? '?'} {rcNo}R
        </span>
        {race?.rc_dist != null && (
          <span className="font-mono-num text-sm font-semibold" style={{ color: 'var(--color-accent-cyan)' }}>
            {race.rc_dist}m
          </span>
        )}
        {race?.rc_name && (
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {race.rc_name}
          </span>
        )}
        {horses && (
          <span className="text-sm font-mono-num ml-auto" style={{ color: 'var(--color-text-disabled)' }}>
            {horses.length}마
          </span>
        )}
      </div>

      {/* ② 경주 조건 배지 */}
      {race && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {race.prize_cond && (
            <span
              className="px-2 py-0.5 rounded text-sm font-semibold border"
              style={{
                background: 'rgba(0,229,255,0.1)',
                border: '1px solid rgba(0,229,255,0.35)',
                color: 'var(--color-accent-cyan)',
              }}
            >
              {race.prize_cond}
            </span>
          )}
          {race.age_cond && (
            <span
              className="px-2 py-0.5 rounded text-sm"
              style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
            >
              {race.age_cond}
            </span>
          )}
          {sexCond && (
            <span
              className="px-2 py-0.5 rounded text-sm"
              style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
            >
              {sexCond}
            </span>
          )}
          {ratingRange && (
            <span
              className="px-2 py-0.5 rounded text-sm font-mono-num"
              style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
            >
              R{ratingRange.min}~{ratingRange.max}
            </span>
          )}
          {race.track && (
            <span className="text-sm" style={{ color: 'var(--color-text-disabled)' }}>
              {race.track}
            </span>
          )}
          {race.weather && (
            <span className="text-sm" style={{ color: 'var(--color-text-disabled)' }}>
              {race.weather}
            </span>
          )}
        </div>
      )}

      {/* ③ 부담중량표 */}
      {weightTable && (
        <div className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span style={{ color: 'var(--color-text-disabled)' }}>부담중량: </span>
          {weightTable}
        </div>
      )}

      {/* ④ 등급 우승마 기록 + 순위 상금 */}
      {(gradeStats || hasPrize) && (
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] pt-1"
          style={{ borderTop: '1px solid var(--color-bg-elevated)' }}
        >
          {gradeStats && (
            <span className="font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
              <span style={{ color: 'var(--color-text-disabled)' }}>등급최고 </span>
              <span style={{ color: 'var(--color-accent-gold)' }}>{formatRcTime(gradeStats.best)}</span>
              <span style={{ color: 'var(--color-text-disabled)' }}> / 평균 </span>
              {formatRcTime(gradeStats.avg)}
              <span style={{ color: 'var(--color-text-disabled)' }}> ({gradeStats.count}경주</span>
              {gradeStats.avgBurdWgt != null && (
                <span style={{ color: 'var(--color-text-disabled)' }}> · 부담{gradeStats.avgBurdWgt.toFixed(1)}kg</span>
              )}
              <span style={{ color: 'var(--color-text-disabled)' }}>)</span>
            </span>
          )}
          {hasPrize && (
            <span className="font-mono-num" style={{ color: 'var(--color-text-secondary)' }}>
              <span style={{ color: 'var(--color-text-disabled)' }}>순위상금 </span>
              <span style={{ color: 'var(--color-accent-gold)' }}>
                {prizeList.join(' · ')}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
