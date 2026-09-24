export interface ReviewerClient {
  requestReviewers(input: { reviewers: string[]; teamReviewers: string[] }): Promise<void>;
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

export type AssignStatus = 'requested' | 'dry-run' | 'skipped' | 'disabled';

/**
 * Assignment is always explicit: decision_only blocks it; assign_reviewers must be true.
 * auto_assign only removes an extra gate when both of those already allow assignment.
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
  // auto_assign=false still allows assignment when assign_reviewers is explicitly true
  // (explicit opt-in). auto_assign documents intent for workflows that always assign.
  void params.autoAssign;
  const { reviewers, teamReviewers } = splitReviewers(params.suggested);
  if (reviewers.length === 0 && teamReviewers.length === 0) return 'skipped';
  if (params.dryRun || !params.client) return 'dry-run';
  await params.client.requestReviewers({ reviewers, teamReviewers });
  return 'requested';
}
