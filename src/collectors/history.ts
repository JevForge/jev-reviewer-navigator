import { normalizeReviewerId } from '../utils/sanitize.js';

export interface HistoryAuthor {
  login: string;
  commitCount: number;
  paths: string[];
}

export interface HistoryClient {
  listCommits(path: string, max: number): Promise<Array<{ authorLogin: string | null }>>;
}

/**
 * Collect recent commit authors for changed paths.
 * Soft evidence only — never invents authors.
 */
export async function collectPathHistory(
  paths: string[],
  lookback: number,
  client: HistoryClient | null,
  enabled: boolean,
): Promise<HistoryAuthor[]> {
  if (!enabled || !client || paths.length === 0) return [];
  const counts = new Map<string, { commitCount: number; paths: Set<string> }>();
  const sample = paths.slice(0, 40);
  for (const path of sample) {
    try {
      const commits = await client.listCommits(path, Math.min(lookback, 50));
      for (const commit of commits) {
        const login = commit.authorLogin ? normalizeReviewerId(commit.authorLogin) : null;
        if (!login || login.startsWith('team:')) continue;
        const entry = counts.get(login) ?? { commitCount: 0, paths: new Set<string>() };
        entry.commitCount += 1;
        entry.paths.add(path);
        counts.set(login, entry);
      }
    } catch {
      // Soft signal — skip failed path queries.
    }
  }
  return [...counts.entries()]
    .map(([login, value]) => ({
      login,
      commitCount: value.commitCount,
      paths: [...value.paths].slice(0, 20),
    }))
    .sort((a, b) => b.commitCount - a.commitCount)
    .slice(0, 64);
}
