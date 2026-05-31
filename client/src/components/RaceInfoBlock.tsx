/**
 * RaceInfoBlock — 경주 상세 정보 카드 (공유 컴포넌트)
 *
 * AI예측 / 예상지 / 출마정보 3개 화면에서 공통 사용.
 * race 데이터 로드 전: 날짜·경마장·경주번호만 표시 (URL 파라미터 기반)
 * race 데이터 로드 후: 등급·상금·부담중량표 추가 표시
 */

import { useMemo } from 'react';
import type { Race, RaceEntry } from '../lib/supabase';

const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부경' };

function formatErng(v: number | null | undefined): string {
  if (v == null || v === 0) return '-';
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString()}만`;
  return String(v);
}

function formatRcDate(d: number): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor((d % 10000) / 100);
  const day = d % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface RaceInfoBlockProps {
  rcDate: number;
  meet: number;
  rcNo: number;
  race?: Race | null;
  horses?: RaceEntry[];
  gradeStats?: { avg: number; best: number; count: number; avgBurdWgt: number | null } | null;
}

export function RaceInfoBlock({
  rcDate,
  meet,
  rcNo,
  race,
  horses,
}: RaceInfoBlockProps) {

  /** 출전마 등급 (rank_str 최다값 → 없으면 prize_cond fallback) */
  const raceGrade = useMemo(() => {
    if (!horses?.length) return race?.prize_cond ?? null;
    const counts = new Map<string, number>();
    horses.forEach((h) => {
      if (h.rank_str) counts.set(h.rank_str, (counts.get(h.rank_str) ?? 0) + 1);
    });
    if (counts.size === 0) return race?.prize_cond ?? null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [horses, race]);

  /** 핸디캡 감지: 같은 연령+성별 그룹에서 부담중량이 다른 말이 있으면 true */
  const isHandicap = useMemo(() => {
    if (!horses?.length) return false;
    const groups = new Map<string, Set<number>>();
    horses.forEach((h) => {
      if (h.ag == null || !h.gndr || h.burd_wgt == null) return;
      const agLabel = h.ag <= 2 ? '2세' : '3세이상';
      const gndrLabel = h.gndr === '암' ? '암' : '수·거';
      const key = `${agLabel}-${gndrLabel}`;
      const wgts = groups.get(key) ?? new Set<number>();
      wgts.add(h.burd_wgt);
      groups.set(key, wgts);
    });
    return [...groups.values()].some((wgts) => wgts.size > 1);
  }, [horses]);

  /** 성별 조건 */
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

  /** 실제 레이팅 범위 (출전마 기준) */
  const ratingRange = useMemo(() => {
    if (!horses?.length) return null;
    const ratings = horses
      .map((h) => h.ratg)
      .filter((r): r is number => r != null && r > 0);
    if (ratings.length === 0) return null;
    return { min: Math.min(...ratings), max: Math.max(...ratings) };
  }, [horses]);

  /** 부담중량표 — 핸디캡이면 (연령+성별)별 min~max 범위, 아니면 단일값 */
  const weightTable = useMemo(() => {
    if (!horses?.length) return null;

    type GroupKey = string; // `${agLabel}-${agOrder}-${gndrLabel}`
    const groups = new Map<GroupKey, { agLabel: string; agOrder: number; gndrLabel: string; weights: number[] }>();

    horses.forEach((h) => {
      if (h.burd_wgt == null || h.ag == null || !h.gndr) return;
      const agLabel = h.ag <= 2 ? '2세' : '3세이상';
      const agOrder = h.ag <= 2 ? 0 : 1;
      const gndrLabel = h.gndr === '암' ? '암' : '수·거';
      const key: GroupKey = `${agLabel}-${agOrder}-${gndrLabel}`;
      const g = groups.get(key) ?? { agLabel, agOrder, gndrLabel, weights: [] };
      g.weights.push(h.burd_wgt);
      groups.set(key, g);
    });

    if (groups.size === 0) return null;

    const sorted = [...groups.values()].sort((a, b) => {
      if (a.agOrder !== b.agOrder) return a.agOrder - b.agOrder;
      return a.gndrLabel === '암' ? -1 : 1;
    });

    // (연령+성별)별로 묶어서 출력
    const byAge = new Map<string, string[]>();
    sorted.forEach(({ agLabel, gndrLabel, weights }) => {
      const min = Math.min(...weights);
      const max = Math.max(...weights);
      const wgtStr = min === max ? `${gndrLabel} ${min}kg` : `${gndrLabel} ${min}~${max}kg`;
      const arr = byAge.get(agLabel) ?? [];
      arr.push(wgtStr);
      byAge.set(agLabel, arr);
    });

    return [...byAge.entries()]
      .map(([ag, parts]) => `${ag}(${parts.join(', ')})`)
      .join(' · ');
  }, [horses]);

  /** 출발시간 파싱: "출발 :10:45" → "10:45" */
  const departureTime = useMemo(() => {
    if (!race?.st_time) return null;
    const match = race.st_time.match(/(\d{1,2}:\d{2})/);
    return match ? match[1] : null;
  }, [race]);

  const hasPrize = race?.chaksun1 || race?.chaksun2 || race?.chaksun3;
  const prizeList = [
    race?.chaksun1 && `1위 ${formatErng(race.chaksun1)}`,
    race?.chaksun2 && `2위 ${formatErng(race.chaksun2)}`,
    race?.chaksun3 && `3위 ${formatErng(race.chaksun3)}`,
  ].filter(Boolean);

  const badgeBase = 'px-2 py-0.5 rounded text-sm';

  return (
    <div
      className="rounded-xl p-4 space-y-2"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-bg-elevated)' }}
    >
      {/* ① 한 줄: 날짜·장소·경주번호·거리 + 조건 배지들 + 출발시간 */}
      <div className="flex items-center gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
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

        {/* 등급 */}
        {raceGrade && (
          <span
            className={badgeBase + ' font-semibold border'}
            style={{
              background: 'rgba(0,229,255,0.1)',
              border: '1px solid rgba(0,229,255,0.35)',
              color: 'var(--color-accent-cyan)',
            }}
          >
            {raceGrade}
          </span>
        )}

        {/* 연령 조건 */}
        {race?.age_cond && (
          <span className={badgeBase} style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}>
            {race.age_cond}
          </span>
        )}

        {/* 성별 조건 */}
        {sexCond && (
          <span className={badgeBase} style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}>
            {sexCond}
          </span>
        )}

        {/* 핸디캡 */}
        {isHandicap && (
          <span className={badgeBase} style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}>
            핸디캡
          </span>
        )}

        {/* 레이팅 범위 */}
        {ratingRange && (
          <span className={badgeBase + ' font-mono-num'} style={{ background: 'var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}>
            R{ratingRange.min}~{ratingRange.max}
          </span>
        )}

        {/* 출발시간 */}
        {departureTime && (
          <span className="font-mono-num text-sm ml-auto" style={{ color: 'var(--color-text-disabled)' }}>
            출발 {departureTime}
          </span>
        )}

        {/* 출전마수 (출발시간 없을 때만 우측) */}
        {!departureTime && horses && (
          <span className="font-mono-num text-sm ml-auto" style={{ color: 'var(--color-text-disabled)' }}>
            {horses.length}마
          </span>
        )}
      </div>

      {/* ② 부담중량 */}
      {weightTable && (
        <div className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span style={{ color: 'var(--color-text-disabled)' }}>부담중량: </span>
          {weightTable}
        </div>
      )}

      {/* ③ 순위상금 */}
      {hasPrize && (
        <div
          className="text-[13px] pt-1"
          style={{ borderTop: '1px solid var(--color-bg-elevated)', color: 'var(--color-text-secondary)' }}
        >
          <span className="font-mono-num" style={{ color: 'var(--color-text-disabled)' }}>순위상금 </span>
          <span className="font-mono-num" style={{ color: 'var(--color-accent-gold)' }}>
            {prizeList.join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}
