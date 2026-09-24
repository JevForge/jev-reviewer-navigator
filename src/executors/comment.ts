import type { NavigatorDecision, ReviewerCandidate } from '../schemas/navigator.js';

export const COMMENT_MARKER = '<!-- jev-reviewer-navigator -->';

function signalCells(candidate: ReviewerCandidate | undefined): string {
  if (!candidate) return '—';
  const s = candidate.signals;
  const parts: string[] = [];
  if (s.codeowners_hit) parts.push('CODEOWNERS');
  if (s.path_history) parts.push('history');
  if (s.label_hint) parts.push('label');
  if (s.component_map) parts.push('component');
  if (s.team_mapped) parts.push('team-map');
  if (s.available === true) parts.push('available');
  if (s.available === false) parts.push('unavailable');
  if (typeof s.open_review_requests === 'number') {
    parts.push(`load=${s.open_review_requests}`);
  }
  return parts.length ? parts.join(', ') : 'allowlist';
}

export function buildCommentMarkdown(
  decision: NavigatorDecision,
  candidates: ReviewerCandidate[] = [],
): string {
  const byId = new Map(candidates.map(c => [c.id, c]));
  const lines = [
    COMMENT_MARKER,
    '### JEV Reviewer Navigator',
    '',
    `- **Decision:** \`${decision.decision}\``,
    `- **Suggested:** ${
      decision.suggested_reviewers.map(r => `\`${r}\``).join(', ') || '`none`'
    }`,
    `- **Ranked:** ${
      decision.ranked_reviewers.map(r => `\`${r}\``).join(', ') || '`none`'
    }`,
    `- **Confidence:** ${decision.confidence.toFixed(3)}`,
    `- **Reason codes:** ${decision.reason_codes.map(c => `\`${c}\``).join(', ')}`,
    `- **Provisional:** ${decision.provisional ? 'yes' : 'no'}`,
    `- **Jev provider:** \`${decision.provider}\``,
    '',
    decision.summary,
  ];

  const rows = decision.ranked_reviewers.length
    ? decision.ranked_reviewers
    : decision.suggested_reviewers;
  if (rows.length > 0) {
    lines.push('', '| Reviewer | Evidence |', '| --- | --- |');
    for (const id of rows) {
      lines.push(`| \`${id}\` | ${signalCells(byId.get(id))} |`);
    }
  }

  lines.push(
    '',
    '_Suggested reviewers are allowlisted only. Assignment requires explicit inputs._',
  );
  return lines.join('\n');
}

export interface CommentClient {
  findExistingCommentId?(): Promise<number | null>;
  createComment(body: string): Promise<void>;
  updateComment?(commentId: number, body: string): Promise<void>;
}

export async function maybePostComment(
  enabled: boolean,
  dryRun: boolean,
  decision: NavigatorDecision,
  client: CommentClient | null,
  candidates: ReviewerCandidate[] = [],
): Promise<'posted' | 'updated' | 'dry-run' | 'skipped'> {
  if (!enabled) return 'skipped';
  const body = buildCommentMarkdown(decision, candidates);
  if (dryRun || !client) return 'dry-run';
  if (client.findExistingCommentId && client.updateComment) {
    const existing = await client.findExistingCommentId();
    if (existing != null) {
      await client.updateComment(existing, body);
      return 'updated';
    }
  }
  await client.createComment(body);
  return 'posted';
}
