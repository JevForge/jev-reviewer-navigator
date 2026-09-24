import type { PolicyOutcome } from '../decision/policy.js';

export interface CheckRunClient {
  createCheckRun(input: {
    name: string;
    headSha: string;
    conclusion: 'success' | 'neutral' | 'failure';
    title: string;
    summary: string;
  }): Promise<void>;
}

function conclusionFor(outcome: PolicyOutcome): 'success' | 'neutral' | 'failure' {
  if (outcome.status === 'ok') return 'success';
  if (outcome.status === 'fail') return 'failure';
  return 'neutral';
}

export async function maybeCreateCheckRun(
  enabled: boolean,
  dryRun: boolean,
  headSha: string | null,
  outcome: PolicyOutcome,
  client: CheckRunClient | null,
): Promise<'created' | 'dry-run' | 'skipped'> {
  if (!enabled) return 'skipped';
  if (!headSha) return 'skipped';
  if (dryRun || !client) return 'dry-run';
  const decision = outcome.decision;
  await client.createCheckRun({
    name: 'JEV Reviewer Navigator',
    headSha,
    conclusion: conclusionFor(outcome),
    title: `${decision.decision} (${decision.confidence.toFixed(2)})`,
    summary: [
      decision.summary,
      '',
      `Suggested: ${decision.suggested_reviewers.join(', ') || 'none'}`,
      `Reasons: ${decision.reason_codes.join(', ')}`,
    ].join('\n'),
  });
  return 'created';
}
