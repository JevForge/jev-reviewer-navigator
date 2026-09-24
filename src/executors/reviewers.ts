export interface ReviewerClient {
  requestReviewers(input: { reviewers: string[]; teamReviewers: string[] }): Promise<void>;
  /** Optional: used for idempotent assignment on synchronize. */
  listRequestedReviewers?(): Promise<{ reviewers: string[]; teamReviewers: string[] }>;
}

export function splitReviewers(ids: string[]): {
  reviewers: string[];
  teamReviewers: string[];
} {
  const reviewers: string[] = [];
  const teamReviewers: string[] = [];
  for (const id of ids) {
    if (id.startsWith('team:')) teamReviewers.push(id.slice('team:'.length));
    else reviewers.push(id.replace(/^@/, ''));
  }
  return { reviewers, teamReviewers };
}

export function diffReviewers(
  suggested: { reviewers: string[]; teamReviewers: string[] },
  already: { reviewers: string[]; teamReviewers: string[] },
): { reviewers: string[]; teamReviewers: string[] } {
  const haveUsers = new Set(already.reviewers.map(u => u.toLowerCase()));
  const haveTeams = new Set(already.teamReviewers.map(t => t.toLowerCase()));
  return {
    reviewers: suggested.reviewers.filter(u => !haveUsers.has(u.toLowerCase())),
    teamReviewers: suggested.teamReviewers.filter(t => !haveTeams.has(t.toLowerCase())),
  };
}

export type AssignStatus =
  | 'requested'
  | 'unchanged'
  | 'dry-run'
  | 'skipped'
  | 'disabled';

/**
 * Assignment is always explicit: decision_only blocks it; assign_reviewers must be true.
 * When the client can list existing requests, only the delta is requested (idempotent).
 */
export async function maybeAssignReviewers(params: {
  decisionOnly: boolean;
  assignReviewers: boolean;
  autoAssign: boolean;
  dryRun: boolean;
  decision: string;
  suggested: string[];
  client: ReviewerClient | null;
}): Promise<AssignStatus> {
  if (params.decisionOnly || !params.assignReviewers) return 'disabled';
  if (params.decision !== 'RECOMMEND_REVIEWERS') return 'skipped';
  if (params.suggested.length === 0) return 'skipped';
  void params.autoAssign;

  const suggested = splitReviewers(params.suggested);
  if (suggested.reviewers.length === 0 && suggested.teamReviewers.length === 0) {
    return 'skipped';
  }

  let toRequest = suggested;
  if (params.client?.listRequestedReviewers) {
    try {
      const already = await params.client.listRequestedReviewers();
      toRequest = diffReviewers(suggested, already);
    } catch {
      // Soft: fall back to full request list
      toRequest = suggested;
    }
  }

  if (toRequest.reviewers.length === 0 && toRequest.teamReviewers.length === 0) {
    return 'unchanged';
  }
  if (params.dryRun || !params.client) return 'dry-run';
  await params.client.requestReviewers(toRequest);
  return 'requested';
}
