import type { JevProvider } from '../jev/contract.js';
import { buildEvidence, buildReviewerQuestions } from '../jev/questions.js';
import {
  deterministicFallback,
  isSchemaRejected,
  unavailableDecision,
} from '../jev/normalize.js';
import { applyConfidencePolicy, enforceAllowlist, type PolicyOutcome } from './policy.js';
import {
  NavigatorDecisionSchema,
  type ReviewerCandidate,
  type NavigatorDecision,
} from '../schemas/navigator.js';
import type { LowConfidencePolicy } from '../schemas/enums.js';

export interface ExecuteInput {
  provider: JevProvider;
  candidates: ReviewerCandidate[];
  changedPaths: string[];
  pathsTruncated: boolean;
  labels: string[];
  author: string | null;
  maxReviewers: number;
  minConfidence: number;
  lowConfidencePolicy: LowConfidencePolicy;
  /** When true, use deterministic CODEOWNERS/history ranking if Jev is unavailable. */
  enableDeterministicFallback: boolean;
}

export interface ExecutionResult {
  outcome: PolicyOutcome;
  rawDecision: NavigatorDecision;
  stateCandidateCount: number;
}

export async function executeNavigator(input: ExecuteInput): Promise<ExecutionResult> {
  const state = buildEvidence({
    changedPaths: input.changedPaths,
    pathsTruncated: input.pathsTruncated,
    labels: input.labels,
    author: input.author,
    maxReviewers: input.maxReviewers,
    candidates: input.candidates,
  });
  const { questions, keyToReviewer } = buildReviewerQuestions(input.candidates);

  let rawDecision: NavigatorDecision;
  try {
    if (input.candidates.length === 0) {
      rawDecision = NavigatorDecisionSchema.parse({
        decision: 'ABSTAIN',
        suggested_reviewers: [],
        ranked_reviewers: [],
        confidence: 0,
        reason_codes: ['NO_CANDIDATES', 'POLICY_ABSTAIN'],
        summary: 'No allowlisted reviewer candidates after filtering',
        provisional: true,
        provider: input.provider.id,
      });
    } else {
      rawDecision = await input.provider.evaluateReviewerSelection({
        state,
        questions,
        keyToReviewer,
      });
    }
  } catch (error) {
    if (!isSchemaRejected(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    rawDecision = unavailableDecision(input.provider.id, message, 'SCHEMA_REJECTED');
  }

  let decision = rawDecision;
  try {
    if (decision.decision === 'RECOMMEND_REVIEWERS') {
      decision = enforceAllowlist(
        decision,
        input.candidates.map(c => c.id),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    decision = unavailableDecision(input.provider.id, message, 'SCHEMA_REJECTED');
  }

  const fallback =
    input.enableDeterministicFallback && decision.reason_codes.includes('JEV_UNAVAILABLE')
      ? deterministicFallback(input.provider.id, state, input.maxReviewers)
      : undefined;

  const outcome = applyConfidencePolicy(
    decision,
    input.minConfidence,
    input.lowConfidencePolicy,
    {
      useDeterministicFallback: Boolean(fallback),
      fallback,
    },
  );

  return {
    outcome,
    rawDecision,
    stateCandidateCount: input.candidates.length,
  };
}
