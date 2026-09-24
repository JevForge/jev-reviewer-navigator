import { describe, expect, it } from 'vitest';
import { NavigatorDecisionSchema } from '../../src/schemas/navigator.js';

describe('NavigatorDecisionSchema contract', () => {
  it('accepts a valid RECOMMEND_REVIEWERS decision', () => {
    const parsed = NavigatorDecisionSchema.parse({
      decision: 'RECOMMEND_REVIEWERS',
      suggested_reviewers: ['alice', 'team:platform'],
      ranked_reviewers: ['alice', 'team:platform'],
      confidence: 0.88,
      reason_codes: ['CODEOWNERS_HIT', 'PATH_HISTORY'],
      summary: 'Suggest alice and platform for auth paths',
      provisional: false,
      provider: 'vercel-ai-gateway',
    });
    expect(parsed.suggested_reviewers).toHaveLength(2);
  });

  it('rejects empty suggested_reviewers on RECOMMEND', () => {
    expect(() =>
      NavigatorDecisionSchema.parse({
        decision: 'RECOMMEND_REVIEWERS',
        suggested_reviewers: [],
        ranked_reviewers: [],
        confidence: 0.9,
        reason_codes: ['CODEOWNERS_HIT'],
        summary: 'bad',
        provisional: false,
        provider: 'vercel-ai-gateway',
      }),
    ).toThrow();
  });

  it('rejects non-empty suggested_reviewers on ABSTAIN', () => {
    expect(() =>
      NavigatorDecisionSchema.parse({
        decision: 'ABSTAIN',
        suggested_reviewers: ['alice'],
        ranked_reviewers: [],
        confidence: 0,
        reason_codes: ['POLICY_ABSTAIN'],
        summary: 'bad',
        provisional: true,
        provider: 'typesafe-native',
      }),
    ).toThrow();
  });

  it('rejects invalid reason codes and reviewer ids', () => {
    expect(() =>
      NavigatorDecisionSchema.parse({
        decision: 'RECOMMEND_REVIEWERS',
        suggested_reviewers: ['not a valid id!!!'],
        ranked_reviewers: [],
        confidence: 0.9,
        reason_codes: ['NOT_A_REAL_CODE'],
        summary: 'bad',
        provisional: false,
        provider: 'vercel-ai-gateway',
      }),
    ).toThrow();
  });

  it('rejects duplicate suggested reviewers', () => {
    expect(() =>
      NavigatorDecisionSchema.parse({
        decision: 'RECOMMEND_REVIEWERS',
        suggested_reviewers: ['alice', 'alice'],
        ranked_reviewers: ['alice'],
        confidence: 0.9,
        reason_codes: ['CODEOWNERS_HIT'],
        summary: 'dup',
        provisional: false,
        provider: 'custom-compatible',
      }),
    ).toThrow();
  });
});
