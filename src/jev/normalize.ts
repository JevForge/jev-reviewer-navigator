import { NavigatorDecisionSchema, type NavigatorDecision } from '../schemas/navigator.js';
import type { JevProviderId, ReasonCode } from '../schemas/enums.js';
import { sanitizeSummary } from '../utils/sanitize.js';
import type { ReviewerEvaluationState } from './contract.js';

export class SchemaRejectedError extends Error {
  constructor(message: string) {
    super(`SCHEMA_REJECTED: ${message}`);
    this.name = 'SchemaRejectedError';
  }
}

export function isSchemaRejected(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('SCHEMA_REJECTED');
}

export interface AnswerValue {
  type?: string;
  probability?: number;
  confidence?: number;
}

export interface RawEvaluation {
  provider: JevProviderId;
  modelLabel: string;
  answers: Record<string, AnswerValue | undefined>;
  confidence?: Record<string, number>;
}

function probabilityOf(answer: AnswerValue | undefined, label: string): number {
  if (!answer || answer.type !== 'boolean' || typeof answer.probability !== 'number') {
    throw new SchemaRejectedError(`${label} must be a boolean answer`);
  }
  if (!Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) {
    throw new SchemaRejectedError(`${label} probability is outside 0..1`);
  }
  return answer.probability;
}

function derivedReasons(
  state: ReviewerEvaluationState,
  selected: string[],
  decision: NavigatorDecision['decision'],
): ReasonCode[] {
  const codes = new Set<ReasonCode>(['CONFIGURED_ALLOWLIST']);
  if (decision === 'ABSTAIN') codes.add('POLICY_ABSTAIN');
  if (decision === 'REQUEST_REVIEW') codes.add('POLICY_REQUEST_REVIEW');
  if (state.candidates.length === 0) codes.add('NO_CANDIDATES');
  const selectedSet = new Set(selected);
  for (const candidate of state.candidates) {
    if (!selectedSet.has(candidate.id)) continue;
    if (candidate.signals.codeowners_hit) codes.add('CODEOWNERS_HIT');
    if (candidate.signals.path_history) codes.add('PATH_HISTORY');
    if (candidate.signals.label_hint) codes.add('LABEL_HINT');
    if (candidate.signals.component_map) codes.add('COMPONENT_MAP');
    if (candidate.signals.monorepo_project) codes.add('MONOREPO_PROJECT');
    if (candidate.signals.team_mapped) codes.add('TEAM_MAPPED');
    if (candidate.signals.available !== null) codes.add('AVAILABILITY_SIGNAL');
    if (candidate.signals.open_review_requests !== null) codes.add('REVIEW_LOAD_SIGNAL');
  }
  return [...codes].slice(0, 16);
}

export function decisionFromEvaluation(
  raw: RawEvaluation,
  state: ReviewerEvaluationState,
  keyToReviewer: Map<string, string>,
  maxReviewers: number,
): NavigatorDecision {
  const scored: Array<{ id: string; probability: number }> = [];
  const margins: number[] = [];
  for (const [key, reviewerId] of keyToReviewer) {
    const probability = probabilityOf(raw.answers[key], key);
    margins.push(Math.max(probability, 1 - probability));
    if (probability >= 0.5) scored.push({ id: reviewerId, probability });
  }
  scored.sort((a, b) => b.probability - a.probability);
  let selected = scored.map(s => s.id);
  const capped = selected.length > maxReviewers;
  selected = selected.slice(0, maxReviewers);

  const abstain = probabilityOf(raw.answers.abstain, 'abstain');
  const review = probabilityOf(raw.answers.request_review, 'request_review');
  const providerConfidence = raw.confidence
    ? Object.entries(raw.confidence)
        .filter(([key]) => keyToReviewer.has(key))
        .map(([, value]) => value)
        .filter(value => typeof value === 'number' && Number.isFinite(value))
    : [];
  const confidence =
    providerConfidence.length > 0
      ? Math.min(
          1,
          Math.max(0, providerConfidence.reduce((sum, value) => sum + value, 0) / providerConfidence.length),
        )
      : margins.length > 0
        ? margins.reduce((sum, value) => sum + value, 0) / margins.length
        : 0;

  let decision: NavigatorDecision['decision'] = 'RECOMMEND_REVIEWERS';
  let suggested = selected;
  if (abstain >= 0.55) {
    decision = 'ABSTAIN';
    suggested = [];
  } else if (review >= 0.55 && confidence < 0.85) {
    decision = 'REQUEST_REVIEW';
    suggested = [];
  } else if (suggested.length === 0) {
    decision = 'ABSTAIN';
  }

  const reasons = derivedReasons(state, suggested, decision);
  if (capped && decision === 'RECOMMEND_REVIEWERS') reasons.push('MAX_REVIEWERS_CAP');

  const summary =
    decision === 'RECOMMEND_REVIEWERS'
      ? `Jev (${raw.provider}, ${raw.modelLabel}) suggested ${suggested.length} allowlisted reviewer(s).`
      : decision === 'ABSTAIN'
        ? `Jev (${raw.provider}, ${raw.modelLabel}) abstained from recommending reviewers.`
        : `Jev (${raw.provider}, ${raw.modelLabel}) requested human review before recommending reviewers.`;

  return NavigatorDecisionSchema.parse({
    decision,
    suggested_reviewers: suggested,
    ranked_reviewers: suggested,
    confidence,
    reason_codes: reasons.slice(0, 16),
    summary: sanitizeSummary(summary),
    provisional: false,
    provider: raw.provider,
  });
}

export function unavailableDecision(
  provider: JevProviderId,
  message: string,
  code: 'JEV_UNAVAILABLE' | 'SCHEMA_REJECTED' = 'JEV_UNAVAILABLE',
): NavigatorDecision {
  return NavigatorDecisionSchema.parse({
    decision: 'ABSTAIN',
    suggested_reviewers: [],
    ranked_reviewers: [],
    confidence: 0,
    reason_codes: [code, 'POLICY_ABSTAIN'],
    summary: sanitizeSummary(message),
    provisional: true,
    provider,
  });
}

/**
 * Deterministic fallback when Jev is unavailable: prefer CODEOWNERS hits, then history.
 */
export function deterministicFallback(
  provider: JevProviderId,
  state: ReviewerEvaluationState,
  maxReviewers: number,
): NavigatorDecision {
  const scored = [...state.candidates]
    .map(c => {
      let score = 0;
      if (c.signals.codeowners_hit) score += 4;
      if (c.signals.component_map) score += 3;
      if (c.signals.monorepo_project) score += 3;
      if (c.signals.path_history) score += 2;
      if (c.signals.label_hint) score += 2;
      if (c.signals.available === false) score -= 2;
      if (typeof c.signals.open_review_requests === 'number') {
        score -= Math.min(3, Math.floor(c.signals.open_review_requests / 3));
      }
      return { id: c.id, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const suggested = scored.map(s => s.id).slice(0, maxReviewers);
  if (suggested.length === 0) {
    return unavailableDecision(provider, 'No deterministic reviewer candidates available');
  }

  return NavigatorDecisionSchema.parse({
    decision: 'RECOMMEND_REVIEWERS',
    suggested_reviewers: suggested,
    ranked_reviewers: suggested,
    confidence: 0.4,
    reason_codes: ['DETERMINISTIC_FALLBACK', 'CONFIGURED_ALLOWLIST'],
    summary: sanitizeSummary(
      `Deterministic fallback suggested ${suggested.length} reviewer(s) after Jev was unavailable.`,
    ),
    provisional: true,
    provider,
  });
}
