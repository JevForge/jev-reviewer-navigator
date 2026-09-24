import { describe, expect, it } from 'vitest';
import { parseCodeowners, ownersForPath, collectCodeownersHits } from '../../src/collectors/codeowners.js';
import { matchPath } from '../../src/utils/globs.js';
import { normalizeReviewerId } from '../../src/utils/sanitize.js';
import { buildCandidates } from '../../src/collectors/candidates.js';
import { splitReviewers, maybeAssignReviewers } from '../../src/executors/reviewers.js';
import {
  enforceAllowlist,
  applyConfidencePolicy,
} from '../../src/decision/policy.js';
import { NavigatorDecisionSchema } from '../../src/schemas/navigator.js';
import { decisionFromEvaluation, deterministicFallback } from '../../src/jev/normalize.js';
import { buildEvidence, buildReviewerQuestions } from '../../src/jev/questions.js';
import { collectAvailability } from '../../src/collectors/availability.js';
import { collectReviewLoad } from '../../src/collectors/load.js';

describe('CODEOWNERS parser', () => {
  it('parses owners and last-match-wins', () => {
    const rules = parseCodeowners(`
# comment
* @org/fallback
/src/ @alice @org/frontend
/src/auth/ @bob team:security
`);
    expect(rules).toHaveLength(3);
    expect(normalizeReviewerId('@org/frontend')).toBe('team:frontend');
    const hit = ownersForPath('src/auth/login.ts', rules);
    expect(hit?.owners).toContain('bob');
    expect(hit?.owners).toContain('team:security');
  });

  it('collects hits per owner', () => {
    const rules = parseCodeowners(`*.ts @alice\nREADME.md @docs-team`);
    const hits = collectCodeownersHits(['a.ts', 'README.md'], rules);
    expect(hits.get('alice')?.paths).toContain('a.ts');
  });
});

describe('globs', () => {
  it('matches simple patterns', () => {
    expect(matchPath('src/a.ts', 'src/*.ts')).toBe(true);
    expect(matchPath('src/a.ts', '**/*.ts')).toBe(true);
    expect(matchPath('docs/a.md', 'src/*.ts')).toBe(false);
  });
});

describe('candidates', () => {
  it('excludes author and intersects allowlist', () => {
    const { candidates, authorExcluded } = buildCandidates({
      allowlist: ['alice', 'bob', 'team:platform'],
      codeownersHits: new Map([['alice', { paths: ['a.ts'], patterns: ['*'] }]]),
      history: [{ login: 'bob', commitCount: 3, paths: ['a.ts'] }],
      labelHints: new Map([['team:platform', ['area/platform']]]),
      componentMap: {},
      changedPaths: ['a.ts'],
      authorLogin: 'alice',
      excludeAuthor: true,
      availability: [],
      loadMetrics: {},
    });
    expect(authorExcluded).toContain('alice');
    expect(candidates.map(c => c.id)).toEqual(['bob', 'team:platform']);
    expect(candidates.find(c => c.id === 'bob')?.signals.path_history).toBe(true);
  });
});

describe('policy', () => {
  it('enforces allowlist', () => {
    const decision = NavigatorDecisionSchema.parse({
      decision: 'RECOMMEND_REVIEWERS',
      suggested_reviewers: ['alice', 'eve'],
      ranked_reviewers: ['alice', 'eve'],
      confidence: 0.9,
      reason_codes: ['CODEOWNERS_HIT'],
      summary: 'ok',
      provisional: false,
      provider: 'vercel-ai-gateway',
    });
    const enforced = enforceAllowlist(decision, ['alice']);
    expect(enforced.suggested_reviewers).toEqual(['alice']);
  });

  it('applies low confidence request-review policy', () => {
    const decision = NavigatorDecisionSchema.parse({
      decision: 'RECOMMEND_REVIEWERS',
      suggested_reviewers: ['alice'],
      ranked_reviewers: ['alice'],
      confidence: 0.2,
      reason_codes: ['CODEOWNERS_HIT'],
      summary: 'low',
      provisional: false,
      provider: 'vercel-ai-gateway',
    });
    const outcome = applyConfidencePolicy(decision, 0.7, 'request-review');
    expect(outcome.status).toBe('request-review');
    expect(outcome.decision.decision).toBe('REQUEST_REVIEW');
  });
});

describe('normalize evaluation', () => {
  it('selects reviewers from boolean answers and caps max', () => {
    const candidates = [
      {
        id: 'alice',
        kind: 'user' as const,
        signals: {
          codeowners_hit: true,
          path_history: false,
          label_hint: false,
          component_map: false,
          team_mapped: false,
          available: null,
          open_review_requests: null,
        },
      },
      {
        id: 'bob',
        kind: 'user' as const,
        signals: {
          codeowners_hit: false,
          path_history: true,
          label_hint: false,
          component_map: false,
          team_mapped: false,
          available: null,
          open_review_requests: null,
        },
      },
      {
        id: 'carol',
        kind: 'user' as const,
        signals: {
          codeowners_hit: true,
          path_history: true,
          label_hint: false,
          component_map: false,
          team_mapped: false,
          available: null,
          open_review_requests: null,
        },
      },
    ];
    const state = buildEvidence({
      changedPaths: ['a.ts'],
      pathsTruncated: false,
      labels: [],
      author: null,
      maxReviewers: 2,
      candidates,
    });
    const { keyToReviewer } = buildReviewerQuestions(candidates);
    const decision = decisionFromEvaluation(
      {
        provider: 'vercel-ai-gateway',
        modelLabel: 'typesafe-ai/jev',
        answers: {
          reviewer_0: { type: 'boolean', probability: 0.9 },
          reviewer_1: { type: 'boolean', probability: 0.8 },
          reviewer_2: { type: 'boolean', probability: 0.95 },
          abstain: { type: 'boolean', probability: 0.1 },
          request_review: { type: 'boolean', probability: 0.1 },
        },
      },
      state,
      keyToReviewer,
      2,
    );
    expect(decision.decision).toBe('RECOMMEND_REVIEWERS');
    expect(decision.suggested_reviewers).toHaveLength(2);
    expect(decision.reason_codes).toContain('MAX_REVIEWERS_CAP');
  });

  it('builds deterministic fallback from CODEOWNERS', () => {
    const state = buildEvidence({
      changedPaths: ['a.ts'],
      pathsTruncated: false,
      labels: [],
      author: null,
      maxReviewers: 1,
      candidates: [
        {
          id: 'alice',
          kind: 'user',
          signals: {
            codeowners_hit: true,
            path_history: false,
            label_hint: false,
            component_map: false,
            team_mapped: false,
            available: null,
            open_review_requests: null,
          },
        },
      ],
    });
    const decision = deterministicFallback('vercel-ai-gateway', state, 1);
    expect(decision.provisional).toBe(true);
    expect(decision.suggested_reviewers).toEqual(['alice']);
  });
});

describe('assign executor', () => {
  it('splits users and teams', () => {
    expect(splitReviewers(['alice', 'team:platform'])).toEqual({
      reviewers: ['alice'],
      teamReviewers: ['platform'],
    });
  });

  it('never assigns when decision_only', async () => {
    const status = await maybeAssignReviewers({
      decisionOnly: true,
      assignReviewers: true,
      autoAssign: true,
      dryRun: false,
      decision: 'RECOMMEND_REVIEWERS',
      suggested: ['alice'],
      client: { requestReviewers: async () => undefined },
    });
    expect(status).toBe('disabled');
  });

  it('dry-runs assignment when enabled', async () => {
    const status = await maybeAssignReviewers({
      decisionOnly: false,
      assignReviewers: true,
      autoAssign: true,
      dryRun: true,
      decision: 'RECOMMEND_REVIEWERS',
      suggested: ['alice'],
      client: { requestReviewers: async () => undefined },
    });
    expect(status).toBe('dry-run');
  });
});

describe('availability and load soft signals', () => {
  it('skips when disabled', async () => {
    const a = await collectAvailability(['alice'], false, null);
    expect(a.status).toBe('skipped');
    const l = await collectReviewLoad(['alice'], false, null);
    expect(l.status).toBe('skipped');
  });

  it('collects membership and load when clients exist', async () => {
    const a = await collectAvailability(['alice', 'team:x'], true, {
      isOrgMember: async () => true,
    });
    expect(a.status).toBe('collected');
    expect(a.signals[0]?.available).toBe(true);
    expect(a.signals[1]?.available).toBeNull();

    const l = await collectReviewLoad(['alice'], true, {
      countOpenReviewRequests: async () => 4,
    });
    expect(l.metrics.alice).toBe(4);
  });
});
