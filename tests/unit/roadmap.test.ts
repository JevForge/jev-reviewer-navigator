import { describe, expect, it, vi } from 'vitest';
import { buildCandidates } from '../../src/collectors/candidates.js';
import { collectReviewLoad } from '../../src/collectors/load.js';
import { parseAffectedProjects, reviewersFromMonorepoPlan } from '../../src/collectors/monorepo.js';
import { applyRequiredReviewers } from '../../src/decision/required.js';
import { writeDecisionOutputs } from '../../src/github/outputs.js';
import { loadNavigatorConfig, mergeAllowlist } from '../../src/collectors/config.js';
import { collectAvailability } from '../../src/collectors/availability.js';
import { createTypesafeNativeProvider } from '../../src/jev/typesafe-native.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

describe('roadmap integrations', () => {
  it('parses affected_projects from JSON and newline input', () => {
    expect(parseAffectedProjects('["apps/web", "packages/auth"]')).toEqual([
      'apps/web',
      'packages/auth',
    ]);
    expect(parseAffectedProjects('apps/web\npackages/auth')).toEqual([
      'apps/web',
      'packages/auth',
    ]);
    expect(parseAffectedProjects('{"affected_projects":["apps/web"]}')).toEqual(['apps/web']);
    expect(parseAffectedProjects('')).toEqual([]);
    expect(reviewersFromMonorepoPlan(
      { affected_projects: ['apps/web'] },
      { 'apps/web': ['alice'] },
      { web: ['bob'] },
    )).toEqual(new Map([['alice', ['apps/web']], ['bob', ['apps/web']]]));
  });

  it('marks candidates with monorepo project evidence', () => {
    const result = buildCandidates({
      allowlist: ['alice'],
      codeownersHits: new Map(),
      history: [],
      labelHints: new Map(),
      componentMap: {},
      changedPaths: ['apps/web/src/app.ts'],
      authorLogin: null,
      excludeAuthor: true,
      availability: [],
      loadMetrics: {},
      monorepoHints: new Map([['alice', ['apps/web']]]),
    });

    expect(result.candidates[0]?.signals.monorepo_project).toBe(true);
    expect(result.candidates[0]?.signals.monorepo_projects).toEqual(['apps/web']);
  });

  it('aggregates open review requests for team members', async () => {
    const count = vi.fn(async (id: string) => (id === 'alice' ? 2 : 3));
    const result = await collectReviewLoad(
      ['team:security'],
      true,
      {
        countOpenReviewRequests: count,
        listTeamMembers: async () => ['alice', 'bob'],
      },
    );

    expect(result.metrics).toEqual({ 'team:security': 5 });
    expect(count).toHaveBeenCalledWith('alice');
    expect(count).toHaveBeenCalledWith('bob');
    expect((await collectReviewLoad(['team:security'], true, {
      countOpenReviewRequests: async () => 1,
    })).metrics).toEqual({});
    expect((await collectReviewLoad(['alice'], true, {
      countOpenReviewRequests: async () => { throw new Error('soft failure'); },
    })).metrics).toEqual({});
  });

  it('writes the first ranked reviewer as primary_reviewer', () => {
    const outputs = new Map<string, string>();
    writeDecisionOutputs(
      {
        setOutput: (name, value) => outputs.set(name, value),
        setFailed: () => undefined,
        warning: () => undefined,
        info: () => undefined,
      },
      {
        decision: 'RECOMMEND_REVIEWERS',
        suggested_reviewers: ['alice', 'bob'],
        ranked_reviewers: ['bob', 'alice'],
        confidence: 0.9,
        reason_codes: ['CONFIGURED_ALLOWLIST'],
        summary: 'ok',
        provisional: false,
        provider: 'custom-compatible',
      },
      {
        affectedPaths: ['src/a.ts'],
        assignStatus: 'disabled',
        availabilityStatus: 'skipped',
        loadMetrics: {},
        needsReview: false,
      },
    );

    expect(outputs.get('primary_reviewer')).toBe('bob');
  });

  it('explains invalid config ids with the expected team syntax', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'jev-rnav-config-'));
    writeFileSync(join(workspace, 'reviewer.yml'), 'allowlist:\n  - foo/bar\n');

    expect(() => loadNavigatorConfig(workspace, 'reviewer.yml')).toThrow(
      /allowlist.*foo\/bar.*team:slug/i,
    );
  });

  it('explains malformed YAML with the config path', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'jev-rnav-yaml-'));
    writeFileSync(join(workspace, 'reviewer.yml'), 'allowlist: [alice\n');

    expect(() => loadNavigatorConfig(workspace, 'reviewer.yml')).toThrow(
      /Invalid reviewer config 'reviewer\.yml'/i,
    );
  });

  it('rejects slash-form input allowlist entries with a migration hint', () => {
    expect(() => mergeAllowlist([], 'foo/bar')).toThrow(
      /allowlist entry 'foo\/bar'.*team:bar/i,
    );
  });

  it('applies a required reviewer floor without bypassing the cap', () => {
    expect(
      applyRequiredReviewers(
        ['alice'],
        ['src/auth/login.ts'],
        [{ paths: ['/src/auth/'], any_of: ['team:security', 'bob'], min: 1 }],
        2,
      ),
    ).toEqual({ reviewers: ['alice', 'team:security'], applied: ['team:security'] });
    expect(applyRequiredReviewers(['alice'], ['src/a.ts'], [{ paths: ['/src/auth/'], any_of: ['bob'], min: 1 }], 1))
      .toEqual({ reviewers: ['alice'], applied: [] });
    expect(applyRequiredReviewers(['alice', 'bob'], ['src/auth/a.ts'], [{ paths: [], any_of: ['alice', 'bob'], min: 2 }], 1))
      .toEqual({ reviewers: ['alice'], applied: [] });
  });

  it('accepts an injected availability source and preserves unknown status', async () => {
    const source = {
      name: 'fixture',
      getAvailability: async (login: string) => login === 'alice',
    };
    const result = await collectAvailability(['alice', 'team:security'], true, source);
    expect(result.signals.map(signal => signal.available)).toEqual([true, null]);
    expect((await collectAvailability(['alice'], true, {})).signals[0]?.available).toBeNull();
    expect((await collectAvailability(['alice'], true, null)).status).toBe('unavailable');
  });

  it('rejects insecure native Jev endpoints before sending the bearer token', async () => {
    const provider = createTypesafeNativeProvider({
      apiKey: 'fixture-key',
      endpoint: 'http://insecure.example/evaluate',
      model: 'fixture',
      timeoutMs: 1000,
      fetchImpl: vi.fn(),
    });

    const result = await provider.evaluateReviewerSelection({
      state: {
        changed_paths: [],
        paths_truncated: false,
        labels: [],
        author: null,
        max_reviewers: 1,
        candidates: [],
        note: 'fixture',
      },
      questions: {},
      keyToReviewer: new Map(),
    });

    expect(result.summary).toMatch(/HTTPS/);
  });

  it('publishes composite metadata with checkout and primary output', () => {
    const composite = YAML.parse(
      readFileSync(join(process.cwd(), 'composite/action.yml'), 'utf8'),
    ) as { runs: { using: string; steps: Array<{ uses?: string }> }; outputs: Record<string, unknown> };
    expect(composite.runs.using).toBe('composite');
    expect(composite.runs.steps.some(step => step.uses === 'actions/checkout@v4')).toBe(true);
    expect(composite.runs.steps.some(step => step.uses === 'JevForge/jev-reviewer-navigator@v0')).toBe(true);
    expect(composite.outputs.primary_reviewer).toBeTruthy();
  });
});
