import { describe, expect, it, vi } from 'vitest';
import { loadJeConfig, loadNavigatorConfig, coalesceProvider, coalescePolicy, mergeAllowlist, resolveEndpoint } from '../../src/collectors/config.js';
import { collectChangedPaths, enrichPathsFromPull } from '../../src/collectors/paths.js';
import { collectLabels, mapLabelsToReviewers } from '../../src/collectors/labels.js';
import { collectPathHistory } from '../../src/collectors/history.js';
import { loadCodeowners, resolveCodeownersPath } from '../../src/collectors/codeowners.js';
import { applyConfidencePolicy, enforceAllowlist } from '../../src/decision/policy.js';
import { NavigatorDecisionSchema } from '../../src/schemas/navigator.js';
import { writeDecisionOutputs, applyPolicyToAction } from '../../src/github/outputs.js';
import { maybePostComment, buildCommentMarkdown } from '../../src/executors/comment.js';
import { maybeCreateCheckRun } from '../../src/executors/check-run.js';
import { createJevProvider } from '../../src/jev/factory.js';
import { createTypesafeNativeProvider } from '../../src/jev/typesafe-native.js';
import { createCustomCompatibleProvider } from '../../src/jev/custom-compatible.js';
import { redactSecrets } from '../../src/utils/redact.js';
import { sanitizePath, parseList } from '../../src/utils/sanitize.js';
import { anyPathMatch, assertSafeGlob } from '../../src/utils/globs.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function baseDecision(overrides: Record<string, unknown> = {}) {
  return NavigatorDecisionSchema.parse({
    decision: 'RECOMMEND_REVIEWERS',
    suggested_reviewers: ['alice'],
    ranked_reviewers: ['alice'],
    confidence: 0.9,
    reason_codes: ['CODEOWNERS_HIT'],
    summary: 'ok',
    provisional: false,
    provider: 'vercel-ai-gateway',
    ...overrides,
  });
}

describe('config collector', () => {
  it('loads missing configs as defaults and coalesces provider/policy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-rn-'));
    expect(loadJeConfig(dir).jev_provider).toBeUndefined();
    expect(loadNavigatorConfig(dir).allowlist).toEqual([]);
    expect(coalesceProvider('', loadNavigatorConfig(dir), loadJeConfig(dir))).toBe(
      'vercel-ai-gateway',
    );
    expect(coalescePolicy('request-review', loadNavigatorConfig(dir), loadJeConfig(dir))).toBe(
      'request-review',
    );
    expect(mergeAllowlist(['alice'], 'bob,team:x')).toEqual(['alice', 'bob', 'team:x']);
    expect(
      resolveEndpoint({
        inputEndpoint: '',
        configEndpoint: 'https://example.com',
        trustRepoEndpoint: false,
      }),
    ).toBeUndefined();
    expect(
      resolveEndpoint({
        inputEndpoint: '',
        configEndpoint: 'https://example.com',
        trustRepoEndpoint: true,
      }),
    ).toBe('https://example.com');
  });

  it('parses yaml configs from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-rn-'));
    mkdirSync(join(dir, '.jev'));
    writeFileSync(
      join(dir, '.jev', 'config.yml'),
      'jev_provider: typesafe-native\nmin_confidence: 0.8\n',
    );
    writeFileSync(
      join(dir, '.jev', 'reviewer-navigator.yml'),
      'allowlist: [alice]\nmax_reviewers: 2\n',
    );
    expect(loadJeConfig(dir).jev_provider).toBe('typesafe-native');
    expect(loadNavigatorConfig(dir).max_reviewers).toBe(2);
  });
});

describe('paths and labels', () => {
  it('parses changed paths from JSON and newlines', () => {
    expect(collectChangedPaths('["a.ts","b.ts"]', {}).paths).toEqual(['a.ts', 'b.ts']);
    expect(collectChangedPaths('a.ts\nb.ts', {}).paths).toEqual(['a.ts', 'b.ts']);
    expect(collectChangedPaths('', {}).paths).toEqual([]);
  });

  it('enriches from pull client', async () => {
    const enriched = await enrichPathsFromPull(
      { paths: [], truncated: false },
      1,
      { listFiles: async () => [{ filename: 'x.ts' }] },
    );
    expect(enriched.paths).toEqual(['x.ts']);
  });

  it('reads labels from input and payload', () => {
    expect(collectLabels('Foo, Bar', {})).toEqual(['foo', 'bar']);
    expect(
      collectLabels('', {
        pull_request: { labels: [{ name: 'area/x' }, 'area/y'] },
      }),
    ).toEqual(['area/x', 'area/y']);
    const mapped = mapLabelsToReviewers(['area/x'], { 'area/x': ['team:x'] });
    expect(mapped.get('team:x')).toContain('area/x');
  });
});

describe('history and codeowners load', () => {
  it('collects history authors', async () => {
    const history = await collectPathHistory(
      ['a.ts'],
      5,
      {
        listCommits: async () => [
          { authorLogin: 'alice' },
          { authorLogin: 'alice' },
          { authorLogin: null },
        ],
      },
      true,
    );
    expect(history[0]?.login).toBe('alice');
    expect(history[0]?.commitCount).toBe(2);
  });

  it('returns empty history when disabled', async () => {
    expect(await collectPathHistory(['a.ts'], 5, null, false)).toEqual([]);
  });

  it('loads CODEOWNERS from workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-rn-'));
    mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, '.github', 'CODEOWNERS'), '* @alice\n');
    expect(resolveCodeownersPath(dir)).toBe('.github/CODEOWNERS');
    const loaded = loadCodeowners(dir);
    expect(loaded.rules[0]?.owners).toContain('alice');
  });
});

describe('policy branches', () => {
  it('handles unavailable with fail/warn/no-op/request-review', () => {
    const unavailable = NavigatorDecisionSchema.parse({
      decision: 'ABSTAIN',
      suggested_reviewers: [],
      ranked_reviewers: [],
      confidence: 0,
      reason_codes: ['JEV_UNAVAILABLE'],
      summary: 'down',
      provisional: true,
      provider: 'vercel-ai-gateway',
    });
    expect(applyConfidencePolicy(unavailable, 0.7, 'fail').status).toBe('fail');
    expect(applyConfidencePolicy(unavailable, 0.7, 'warn').status).toBe('warn');
    expect(applyConfidencePolicy(unavailable, 0.7, 'no-op').status).toBe('no-op');
    expect(applyConfidencePolicy(unavailable, 0.7, 'request-review').status).toBe(
      'request-review',
    );
  });

  it('handles abstain policies and warn on low confidence', () => {
    const abstain = NavigatorDecisionSchema.parse({
      decision: 'ABSTAIN',
      suggested_reviewers: [],
      ranked_reviewers: [],
      confidence: 0.5,
      reason_codes: ['POLICY_ABSTAIN'],
      summary: 'nope',
      provisional: false,
      provider: 'vercel-ai-gateway',
    });
    expect(applyConfidencePolicy(abstain, 0.7, 'warn').status).toBe('warn');
    expect(applyConfidencePolicy(abstain, 0.7, 'no-op').status).toBe('no-op');
    expect(applyConfidencePolicy(abstain, 0.7, 'fail').status).toBe('fail');
    expect(applyConfidencePolicy(abstain, 0.7, 'request-review').status).toBe('request-review');

    const low = baseDecision({ confidence: 0.1 });
    expect(applyConfidencePolicy(low, 0.7, 'warn').status).toBe('warn');
    expect(applyConfidencePolicy(low, 0.7, 'fail').status).toBe('fail');
    expect(applyConfidencePolicy(low, 0.7, 'no-op').status).toBe('no-op');
  });

  it('clears suggestions for non-recommend decisions', () => {
    const decision = NavigatorDecisionSchema.parse({
      decision: 'REQUEST_REVIEW',
      suggested_reviewers: [],
      ranked_reviewers: [],
      confidence: 0.5,
      reason_codes: ['POLICY_REQUEST_REVIEW'],
      summary: 'review',
      provisional: false,
      provider: 'vercel-ai-gateway',
    });
    expect(enforceAllowlist(decision, ['alice']).suggested_reviewers).toEqual([]);
  });
});

describe('outputs and executors', () => {
  it('writes outputs and applies policy statuses', () => {
    const outputs: Record<string, string> = {};
    const writer = {
      setOutput: (n: string, v: string) => {
        outputs[n] = v;
      },
      setFailed: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    };
    writeDecisionOutputs(writer, baseDecision(), {
      affectedPaths: ['a.ts'],
      assignStatus: 'disabled',
      availabilityStatus: 'skipped',
      loadMetrics: {},
      needsReview: false,
    });
    expect(outputs.decision).toBe('RECOMMEND_REVIEWERS');

    applyPolicyToAction(writer, { status: 'warn', decision: baseDecision(), message: 'w' }, {
      affectedPaths: [],
      assignStatus: 'skipped',
      availabilityStatus: 'skipped',
      loadMetrics: {},
      dryRun: true,
    });
    expect(writer.warning).toHaveBeenCalled();

    applyPolicyToAction(
      writer,
      { status: 'fail', decision: baseDecision(), message: 'f' },
      {
        affectedPaths: [],
        assignStatus: 'skipped',
        availabilityStatus: 'skipped',
        loadMetrics: {},
        dryRun: true,
      },
    );
    expect(writer.warning).toHaveBeenCalledWith(expect.stringContaining('dry_run'));

    applyPolicyToAction(
      writer,
      { status: 'fail', decision: baseDecision(), message: 'f' },
      {
        affectedPaths: [],
        assignStatus: 'skipped',
        availabilityStatus: 'skipped',
        loadMetrics: {},
        dryRun: false,
      },
    );
    expect(writer.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('[JEV Reviewer Navigator]'),
    );

    applyPolicyToAction(
      writer,
      { status: 'request-review', decision: baseDecision({ decision: 'REQUEST_REVIEW', suggested_reviewers: [], ranked_reviewers: [] }) },
      {
        affectedPaths: [],
        assignStatus: 'skipped',
        availabilityStatus: 'skipped',
        loadMetrics: {},
        dryRun: false,
      },
    );
    applyPolicyToAction(
      writer,
      { status: 'no-op', decision: baseDecision(), message: 'noop' },
      {
        affectedPaths: [],
        assignStatus: 'skipped',
        availabilityStatus: 'skipped',
        loadMetrics: {},
        dryRun: false,
      },
    );
    expect(writer.info).toHaveBeenCalled();
  });

  it('posts and updates comments; creates check runs', async () => {
    const withSignals = baseDecision();
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
          open_review_requests: 2,
        },
      },
    ];
    expect(buildCommentMarkdown(withSignals, candidates)).toContain('| Reviewer | Evidence |');
    expect(buildCommentMarkdown(withSignals, candidates)).toContain('CODEOWNERS');
    expect(buildCommentMarkdown(withSignals, candidates)).toContain('load=2');
    expect(await maybePostComment(false, false, baseDecision(), null)).toBe('skipped');
    expect(await maybePostComment(true, true, baseDecision(), null, candidates)).toBe('dry-run');

    const createComment = vi.fn();
    const updateComment = vi.fn();
    expect(
      await maybePostComment(true, false, baseDecision(), {
        createComment,
        findExistingCommentId: async () => null,
        updateComment,
      }),
    ).toBe('posted');
    expect(
      await maybePostComment(true, false, baseDecision(), {
        createComment,
        findExistingCommentId: async () => 9,
        updateComment,
      }),
    ).toBe('updated');

    expect(await maybeCreateCheckRun(false, false, 'sha', { status: 'ok', decision: baseDecision() }, null)).toBe(
      'skipped',
    );
    expect(
      await maybeCreateCheckRun(true, true, 'sha', { status: 'ok', decision: baseDecision() }, null),
    ).toBe('dry-run');
    const createCheckRun = vi.fn();
    expect(
      await maybeCreateCheckRun(
        true,
        false,
        'sha',
        { status: 'fail', decision: baseDecision(), message: 'x' },
        { createCheckRun },
      ),
    ).toBe('created');
    expect(createCheckRun).toHaveBeenCalled();
  });
});

describe('providers', () => {
  it('factory rejects unknown and native/custom validate credentials', async () => {
    expect(() =>
      createJevProvider({ provider: 'nope' as never, timeoutMs: 1000 }),
    ).toThrow(/Unsupported/);

    const native = createTypesafeNativeProvider({ timeoutMs: 1000 });
    expect((await native.evaluateReviewerSelection({
      state: {
        changed_paths: [],
        paths_truncated: false,
        labels: [],
        author: null,
        max_reviewers: 1,
        candidates: [],
        note: 'n',
      },
      questions: {},
      keyToReviewer: new Map(),
    })).reason_codes).toContain('JEV_UNAVAILABLE');

    const custom = createCustomCompatibleProvider({ timeoutMs: 1000, apiKey: 'k' });
    expect(
      (
        await custom.evaluateReviewerSelection({
          state: {
            changed_paths: [],
            paths_truncated: false,
            labels: [],
            author: null,
            max_reviewers: 1,
            candidates: [],
            note: 'n',
          },
          questions: {},
          keyToReviewer: new Map(),
        })
      ).summary,
    ).toMatch(/endpoint/);

    const customHttps = createCustomCompatibleProvider({
      timeoutMs: 1000,
      apiKey: 'k',
      endpoint: 'http://insecure.example',
      model: 'm',
    });
    expect(
      (
        await customHttps.evaluateReviewerSelection({
          state: {
            changed_paths: [],
            paths_truncated: false,
            labels: [],
            author: null,
            max_reviewers: 1,
            candidates: [],
            note: 'n',
          },
          questions: {},
          keyToReviewer: new Map(),
        })
      ).summary,
    ).toMatch(/HTTPS/);

    const okFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        answers: {
          reviewer_0: { type: 'boolean', probability: 0.2 },
          abstain: { type: 'boolean', probability: 0.9 },
          request_review: { type: 'boolean', probability: 0.1 },
        },
      }),
    }));
    const nativeOk = createTypesafeNativeProvider({
      timeoutMs: 5000,
      apiKey: 'k',
      model: 'catalog-model',
      fetchImpl: okFetch as never,
    });
    const decision = await nativeOk.evaluateReviewerSelection({
      state: {
        changed_paths: ['a.ts'],
        paths_truncated: false,
        labels: [],
        author: null,
        max_reviewers: 1,
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
        note: 'n',
      },
      questions: {
        reviewer_0: { type: 'boolean', instructions: 'x' },
        abstain: { type: 'boolean', instructions: 'x' },
        request_review: { type: 'boolean', instructions: 'x' },
      },
      keyToReviewer: new Map([['reviewer_0', 'alice']]),
    });
    expect(decision.decision).toBe('ABSTAIN');

    const customOk = createCustomCompatibleProvider({
      timeoutMs: 5000,
      apiKey: 'k',
      endpoint: 'https://jev.example/evaluate',
      model: 'm',
      fetchImpl: okFetch as never,
    });
    const customDecision = await customOk.evaluateReviewerSelection({
      state: {
        changed_paths: ['a.ts'],
        paths_truncated: false,
        labels: [],
        author: null,
        max_reviewers: 1,
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
        note: 'n',
      },
      questions: {
        reviewer_0: { type: 'boolean', instructions: 'x' },
        abstain: { type: 'boolean', instructions: 'x' },
        request_review: { type: 'boolean', instructions: 'x' },
      },
      keyToReviewer: new Map([['reviewer_0', 'alice']]),
    });
    expect(customDecision.provider).toBe('custom-compatible');
  });
});

describe('utils', () => {
  it('redacts and sanitizes', () => {
    expect(redactSecrets('Bearer abcdefghijklmnop')).toContain('[REDACTED]');
    expect(sanitizePath('\\foo\\bar')).toBe('foo/bar');
    expect(parseList('a, b\nc')).toEqual(['a', 'b', 'c']);
    expect(anyPathMatch(['src/a.ts'], ['src/*.ts'])).toBe(true);
    expect(() => assertSafeGlob('..')).toThrow();
  });
});
