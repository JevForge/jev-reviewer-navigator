export interface LoadMetrics {
  [reviewerId: string]: number;
}

export interface LoadClient {
  countOpenReviewRequests(loginOrTeam: string): Promise<number>;
}

/**
 * Soft review-load signal from open PR review requests.
 * Missing token → empty metrics; never fabricates load.
 */
export async function collectReviewLoad(
  candidateIds: string[],
  enabled: boolean,
  client: LoadClient | null,
): Promise<{ metrics: LoadMetrics; status: 'collected' | 'skipped' | 'unavailable' }> {
  if (!enabled) return { metrics: {}, status: 'skipped' };
  if (!client) return { metrics: {}, status: 'unavailable' };

  const metrics: LoadMetrics = {};
  for (const id of candidateIds.slice(0, 32)) {
    if (id.startsWith('team:')) continue;
    try {
      metrics[id] = await client.countOpenReviewRequests(id);
    } catch {
      // Soft signal
    }
  }
  return { metrics, status: 'collected' };
}
