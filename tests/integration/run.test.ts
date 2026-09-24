import { describe, expect, it, vi } from 'vitest';
import { runNavigator } from '../../src/run.js';
import type { JevProvider } from '../../src/jev/contract.js';
import { createJevProvider } from '../../src/jev/factory.js';
import type { ReviewerCandidate } from '../../src/schemas/navigator.js';

const candidates: ReviewerCandidate[] = [
  {
    id: 'alice',
    kind: 'user',
    signals: {
      codeowners_hit: true,
      path_history: false,
      label_hint: false,
      component_map: false,
      team_mapped: false,
      available: true,
      open_review_requests: 1,
    },
  },
  {
    id: 'team:platform',
    kind: 'team',
    signals: {
      codeowners_hit: false,
      path_history: false,
      label_hint: true,
      component_map: true,
      team_mapped: true,
      available: null,
      open_review_requests: null,
    },
  },
];

function mockProvider(answers: Record<string, { type: string; probability: number }>): JevProvider {
  return {
    id: 'vercel-ai-gateway',
    async evaluateReviewerSelection(request) {
      const { decisionFromEvaluation } = await import('../../src/jev/normalize.js');
      return decisionFromEvaluation(
        {
          provider: 'vercel-ai-gateway',
          modelLabel: 'typesafe-ai/jev',
          answers,
        },
        request.state,
        request.keyToReviewer,
        request.state.max_reviewers,
      );
    },
  };
}

describe('runNavigator integration', () => {
  it('recommends without assigning in decision_only mode', async () => {
    const requestReviewers = vi.fn();
    // Patch factory by injecting evaluate via createJevProvider path:
    // use runNavigator with real factory but no api key → unavailable → fallback
    const result = await runNavigator({
      candidates,
      changedPaths: ['src/a.ts'],
      pathsTruncated: false,
      labels: ['area/platform'],
      author: 'carol',
      maxReviewers: 2,
      minConfidence: 0.3,
      lowConfidencePolicy: 'warn',
      jevProvider: 'vercel-ai-gateway',
      timeoutMs: 5_000,
      apiKey: undefined,
      decisionOnly: true,
      assignReviewers: true,
      autoAssign: true,
      dryRun: false,
      commentOnGithub: false,
      createCheckRun: false,
      enableDeterministicFallback: true,
      availabilityStatus: 'collected',
      loadMetrics: { alice: 1 },
      reviewerClient: { requestReviewers },
    });

    expect(result.outcome.decision.decision).toBe('RECOMMEND_REVIEWERS');
    expect(result.outcome.decision.suggested_reviewers.length).toBeGreaterThan(0);
    expect(result.assignStatus).toBe('disabled');
    expect(requestReviewers).not.toHaveBeenCalled();
  });

  it('assigns when explicitly enabled and not dry_run', async () => {
    const requestReviewers = vi.fn(async () => undefined);
    const provider = mockProvider({
      reviewer_0: { type: 'boolean', probability: 0.95 },
      reviewer_1: { type: 'boolean', probability: 0.8 },
      abstain: { type: 'boolean', probability: 0.05 },
      request_review: { type: 'boolean', probability: 0.05 },
    });

    // Direct execute path via createJevProvider won't use our mock; call execute through run with custom evaluateImpl
    const gateway = createJevProvider({
      provider: 'vercel-ai-gateway',
      apiKey: 'test-key',
      timeoutMs: 5_000,
      evaluateImpl: async () => ({
        answers: {
          reviewer_0: { type: 'boolean', probability: 0.95 },
          reviewer_1: { type: 'boolean', probability: 0.8 },
          abstain: { type: 'boolean', probability: 0.05 },
          request_review: { type: 'boolean', probability: 0.05 },
        },
      }),
    });

    // Use executeNavigator + assign manually for this case
    const { executeNavigator } = await import('../../src/decision/execute.js');
    const { maybeAssignReviewers } = await import('../../src/executors/reviewers.js');
    const executed = await executeNavigator({
      provider: gateway,
      candidates,
      changedPaths: ['src/a.ts'],
      pathsTruncated: false,
      labels: [],
      author: null,
      maxReviewers: 2,
      minConfidence: 0.5,
      lowConfidencePolicy: 'warn',
      enableDeterministicFallback: false,
    });

    expect(executed.outcome.decision.decision).toBe('RECOMMEND_REVIEWERS');

    const status = await maybeAssignReviewers({
      decisionOnly: false,
      assignReviewers: true,
      autoAssign: true,
      dryRun: false,
      decision: executed.outcome.decision.decision,
      suggested: executed.outcome.decision.suggested_reviewers,
      client: { requestReviewers },
    });
    expect(status).toBe('requested');
    expect(requestReviewers).toHaveBeenCalled();
    void provider;
  });

  it('dry_run never calls requestReviewers', async () => {
    const requestReviewers = vi.fn();
    const result = await runNavigator({
      candidates,
      changedPaths: ['src/a.ts'],
      pathsTruncated: false,
      labels: [],
      author: null,
      maxReviewers: 2,
      minConfidence: 0.3,
      lowConfidencePolicy: 'no-op',
      jevProvider: 'vercel-ai-gateway',
      timeoutMs: 5_000,
      decisionOnly: false,
      assignReviewers: true,
      autoAssign: true,
      dryRun: true,
      commentOnGithub: true,
      createCheckRun: true,
      enableDeterministicFallback: true,
      headSha: 'abc',
      availabilityStatus: 'skipped',
      loadMetrics: {},
      reviewerClient: { requestReviewers },
      commentClient: { createComment: async () => undefined },
      checkRunClient: {
        createCheckRun: async () => undefined,
      },
    });
    expect(result.assignStatus).toBe('dry-run');
    expect(result.commentStatus).toBe('dry-run');
    expect(result.checkStatus).toBe('dry-run');
    expect(requestReviewers).not.toHaveBeenCalled();
  });
});
