import type { LowConfidencePolicy, ReasonCode } from '../schemas/enums.js';
import type { NavigatorDecision } from '../schemas/navigator.js';
import { NavigatorDecisionSchema } from '../schemas/navigator.js';

function mergeReasons(current: ReasonCode[], ...extra: ReasonCode[]): ReasonCode[] {
  return [...new Set([...current, ...extra])].slice(0, 16) as ReasonCode[];
}

export type PolicyOutcome =
  | { status: 'ok'; decision: NavigatorDecision }
  | { status: 'fail'; decision: NavigatorDecision; message: string }
  | { status: 'warn'; decision: NavigatorDecision; message: string }
  | { status: 'request-review'; decision: NavigatorDecision }
  | { status: 'no-op'; decision: NavigatorDecision; message: string };

export function enforceAllowlist(
  decision: NavigatorDecision,
  candidateIds: string[],
): NavigatorDecision {
  const allow = new Set(candidateIds);
  if (decision.decision !== 'RECOMMEND_REVIEWERS') {
    return NavigatorDecisionSchema.parse({
      ...decision,
      suggested_reviewers: [],
      ranked_reviewers: [],
    });
  }
  const filtered = decision.suggested_reviewers.filter(id => allow.has(id));
  const ranked = (decision.ranked_reviewers.length
    ? decision.ranked_reviewers
    : decision.suggested_reviewers
  ).filter(id => allow.has(id) && filtered.includes(id));

  if (filtered.length === 0) {
    throw new Error('SCHEMA_REJECTED: suggested_reviewers outside allowlist or empty after filter');
  }

  return NavigatorDecisionSchema.parse({
    ...decision,
    suggested_reviewers: filtered,
    ranked_reviewers: ranked.length ? ranked : filtered,
    reason_codes: mergeReasons(decision.reason_codes, 'ALLOWLIST_FILTER'),
  });
}

export function applyConfidencePolicy(
  decision: NavigatorDecision,
  minConfidence: number,
  policy: LowConfidencePolicy,
  options?: { useDeterministicFallback?: boolean; fallback?: NavigatorDecision },
): PolicyOutcome {
  let validated = NavigatorDecisionSchema.parse(decision);

  if (validated.reason_codes.includes('JEV_UNAVAILABLE') && options?.useDeterministicFallback && options.fallback) {
    validated = NavigatorDecisionSchema.parse(options.fallback);
  }

  if (validated.reason_codes.includes('JEV_UNAVAILABLE') && validated.provisional && !options?.fallback) {
    if (policy === 'no-op') {
      return {
        status: 'no-op',
        decision: {
          ...validated,
          reason_codes: mergeReasons(validated.reason_codes, 'POLICY_NO_OP'),
        },
        message: validated.summary,
      };
    }
    if (policy === 'warn') {
      return {
        status: 'warn',
        decision: {
          ...validated,
          reason_codes: mergeReasons(validated.reason_codes, 'POLICY_WARN'),
        },
        message: validated.summary,
      };
    }
    if (policy === 'request-review') {
      return {
        status: 'request-review',
        decision: NavigatorDecisionSchema.parse({
          ...validated,
          decision: 'REQUEST_REVIEW',
          suggested_reviewers: [],
          ranked_reviewers: [],
          reason_codes: mergeReasons(validated.reason_codes, 'POLICY_REQUEST_REVIEW'),
        }),
      };
    }
    return {
      status: 'fail',
      decision: {
        ...validated,
        reason_codes: mergeReasons(validated.reason_codes, 'POLICY_FAIL'),
      },
      message: validated.summary || 'JEV unavailable',
    };
  }

  if (validated.decision === 'ABSTAIN') {
    if (policy === 'no-op') return { status: 'no-op', decision: validated, message: 'Abstained' };
    if (policy === 'warn') return { status: 'warn', decision: validated, message: 'Abstained' };
    if (policy === 'request-review') {
      return {
        status: 'request-review',
        decision: NavigatorDecisionSchema.parse({
          ...validated,
          decision: 'REQUEST_REVIEW',
          reason_codes: mergeReasons(validated.reason_codes, 'POLICY_REQUEST_REVIEW'),
        }),
      };
    }
    return { status: 'fail', decision: validated, message: 'Reviewer Navigator abstained' };
  }

  if (validated.decision === 'REQUEST_REVIEW') {
    return { status: 'request-review', decision: validated };
  }

  if (validated.confidence < minConfidence) {
    const low = NavigatorDecisionSchema.parse({
      ...validated,
      decision: 'REQUEST_REVIEW' as const,
      suggested_reviewers: [],
      ranked_reviewers: [],
      reason_codes: mergeReasons(
        validated.reason_codes,
        'LOW_CONFIDENCE',
        'POLICY_REQUEST_REVIEW',
      ),
      summary: `Confidence ${validated.confidence} below min_confidence ${minConfidence}`,
      provisional: true,
    });

    if (policy === 'fail') {
      return { status: 'fail', decision: low, message: low.summary };
    }
    if (policy === 'warn') {
      return {
        status: 'warn',
        decision: validated,
        message: low.summary,
      };
    }
    if (policy === 'request-review') {
      return { status: 'request-review', decision: low };
    }
    return { status: 'no-op', decision: validated, message: low.summary };
  }

  return { status: 'ok', decision: validated };
}
