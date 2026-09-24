import { executeNavigator } from './decision/execute.js';
import {
  buildCacheKey,
  fingerprintConfig,
  saveDecisionCache,
  tryRestoreDecisionCache,
} from './decision/cache.js';
import { createJevProvider } from './jev/factory.js';
import type { JevProviderId, LowConfidencePolicy } from './schemas/enums.js';
import type { ReviewerCandidate } from './schemas/navigator.js';
import { maybeAssignReviewers, type AssignStatus, type ReviewerClient } from './executors/reviewers.js';
import { maybePostComment, type CommentClient } from './executors/comment.js';
import { maybeCreateCheckRun, type CheckRunClient } from './executors/check-run.js';
import type { AvailabilityStatus } from './collectors/availability.js';
import type { LoadMetrics } from './collectors/load.js';
import type { PolicyOutcome } from './decision/policy.js';
import { join } from 'node:path';

export interface RunNavigatorParams {
  candidates: ReviewerCandidate[];
  changedPaths: string[];
  pathsTruncated: boolean;
  labels: string[];
  author: string | null;
  maxReviewers: number;
  minConfidence: number;
  lowConfidencePolicy: LowConfidencePolicy;
  jevProvider: JevProviderId;
  jevEndpoint?: string;
  jevModel?: string;
  timeoutMs: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  decisionOnly: boolean;
  assignReviewers: boolean;
  autoAssign: boolean;
  dryRun: boolean;
  commentOnGithub: boolean;
  createCheckRun: boolean;
  enableDeterministicFallback: boolean;
  cacheDecisions?: boolean;
  cacheConfigFingerprint?: string;
  workspace?: string;
  headSha?: string | null;
  availabilityStatus: AvailabilityStatus;
  loadMetrics: LoadMetrics;
  reviewerClient?: ReviewerClient | null;
  commentClient?: CommentClient | null;
  checkRunClient?: CheckRunClient | null;
}

export interface RunNavigatorResult {
  outcome: PolicyOutcome;
  summary: string;
  assignStatus: AssignStatus;
  commentStatus: 'posted' | 'updated' | 'dry-run' | 'skipped';
  checkStatus: 'created' | 'dry-run' | 'skipped';
  availabilityStatus: AvailabilityStatus;
  loadMetrics: LoadMetrics;
  cacheHit: boolean;
}

export async function runNavigator(params: RunNavigatorParams): Promise<RunNavigatorResult> {
  const cacheEnabled = Boolean(params.cacheDecisions);
  const cacheDir = join(params.workspace || process.cwd(), '.jev', '.decision-cache');
  const cacheKey = buildCacheKey({
    sha: params.headSha || 'nosha',
    configFingerprint: params.cacheConfigFingerprint || fingerprintConfig({}),
    paths: params.changedPaths,
    provider: params.jevProvider,
    maxReviewers: params.maxReviewers,
  });

  let outcome: PolicyOutcome | null = await tryRestoreDecisionCache({
    enabled: cacheEnabled,
    key: cacheKey,
    cacheDir,
  });
  const cacheHit = outcome != null;

  if (!outcome) {
    const provider = createJevProvider({
      provider: params.jevProvider,
      apiKey: params.apiKey,
      endpoint: params.jevEndpoint,
      model: params.jevModel,
      timeoutMs: params.timeoutMs,
      fetchImpl: params.fetchImpl,
    });

    const executed = await executeNavigator({
      provider,
      candidates: params.candidates,
      changedPaths: params.changedPaths,
      pathsTruncated: params.pathsTruncated,
      labels: params.labels,
      author: params.author,
      maxReviewers: params.maxReviewers,
      minConfidence: params.minConfidence,
      lowConfidencePolicy: params.lowConfidencePolicy,
      enableDeterministicFallback: params.enableDeterministicFallback,
    });
    outcome = executed.outcome;
    await saveDecisionCache({
      enabled: cacheEnabled,
      key: cacheKey,
      cacheDir,
      outcome,
    });
  }

  const decision = outcome.decision;
  const summary = [
    `${decision.decision}: ${decision.suggested_reviewers.join(',') || 'none'}`,
    `confidence=${decision.confidence}`,
    `reasons=${decision.reason_codes.join(',')}`,
    cacheHit ? 'cache=hit' : 'cache=miss',
  ].join(' | ');

  const assignStatus = await maybeAssignReviewers({
    decisionOnly: params.decisionOnly,
    assignReviewers: params.assignReviewers,
    autoAssign: params.autoAssign,
    dryRun: params.dryRun,
    decision: decision.decision,
    suggested: decision.suggested_reviewers,
    client: params.reviewerClient ?? null,
  });

  const commentStatus = await maybePostComment(
    params.commentOnGithub,
    params.dryRun,
    decision,
    params.commentClient ?? null,
    params.candidates,
  );

  const checkStatus = await maybeCreateCheckRun(
    params.createCheckRun,
    params.dryRun,
    params.headSha ?? null,
    outcome,
    params.checkRunClient ?? null,
  );

  return {
    outcome,
    summary,
    assignStatus,
    commentStatus,
    checkStatus,
    availabilityStatus: params.availabilityStatus,
    loadMetrics: params.loadMetrics,
    cacheHit,
  };
}
