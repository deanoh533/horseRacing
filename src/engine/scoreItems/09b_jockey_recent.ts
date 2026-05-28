export interface JockeyRecentInput {
  recentOrds: number[];
}

export function calculateJockeyRecentScore(input: JockeyRecentInput): number {
  const { recentOrds } = input;
  if (!recentOrds || recentOrds.length === 0) return 0.5;
  const wins = recentOrds.filter(o => o === 1).length;
  return wins / recentOrds.length;
}
