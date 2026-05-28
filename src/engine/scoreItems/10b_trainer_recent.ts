export interface TrainerRecentInput {
  recentOrds: number[];
}

export function calculateTrainerRecentScore(input: TrainerRecentInput): number {
  const { recentOrds } = input;
  if (!recentOrds || recentOrds.length === 0) return 0.5;
  const places = recentOrds.filter(o => o <= 2).length;
  return places / recentOrds.length;
}
