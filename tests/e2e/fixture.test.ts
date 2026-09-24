import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../../src/action/main.js';

describe('offline synthetic pull request fixture', () => {
  it('runs the action layer with a mock provider and required reviewer floor', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'jev-rnav-e2e-'));
    writeFileSync(
      join(workspace, '.jev-reviewer-navigator.yml'),
      [
        'allowlist: [alice, bob]',
        'required_reviewers:',
        '  - paths: [/src/auth/]',
        '    any_of: [bob]',
        '    min: 1',
      ].join('\n'),
    );

    const outputs = new Map<string, string>();
    await runAction({
      inputs: {
        config_path: '.jev-reviewer-navigator.yml',
        changed_paths: '["src/auth/login.ts"]',
        jev_provider: 'custom-compatible',
        jev_endpoint: 'https://fixture.invalid/evaluate',
        jev_model: 'fixture',
        dry_run: 'true',
        min_confidence: '0.6',
      },
      env: { JEV_CUSTOM_API_KEY: 'fixture-key' },
      workspace,
      eventName: 'pull_request',
      payload: { pull_request: { number: 7, user: { login: 'carol' }, head: { sha: 'abc' } } },
      repo: { owner: 'fixture', repo: 'repo' },
      fetch: async () =>
        new Response(
          JSON.stringify({
            answers: {
              reviewer_0: { type: 'boolean', probability: 0.95 },
              reviewer_1: { type: 'boolean', probability: 0.05 },
              abstain: { type: 'boolean', probability: 0.05 },
              request_review: { type: 'boolean', probability: 0.05 },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      info: () => undefined,
      warning: () => undefined,
      setOutput: (name, value) => outputs.set(name, value),
      setFailed: message => {
        throw new Error(message);
      },
      octokit: null,
    });

    expect(JSON.parse(outputs.get('suggested_reviewers') ?? '[]')).toEqual(['alice', 'bob']);
    expect(outputs.get('primary_reviewer')).toBe('alice');
    expect(JSON.parse(outputs.get('reason_codes') ?? '[]')).toContain('REQUIRED_REVIEWER');
  });
});
