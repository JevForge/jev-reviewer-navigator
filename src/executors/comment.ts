import type { NavigatorDecision } from '../schemas/navigator.js';

export const COMMENT_MARKER = '<!-- jev-reviewer-navigator -->';

export function buildCommentMarkdown(decision: NavigatorDecision): string {
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
    '',
    '_Suggested reviewers are allowlisted only. Assignment requires explicit inputs._',
  ];
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
): Promise<'posted' | 'updated' | 'dry-run' | 'skipped'> {
  if (!enabled) return 'skipped';
  const body = buildCommentMarkdown(decision);
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
