import * as core from '@actions/core';
import * as github from '@actions/github';
import { runAction } from './action/main.js';

const INPUT_NAMES = [
  'config_path',
  'changed_paths',
  'codeowners_path',
  'allowlist',
  'exclude_author',
  'max_reviewers',
  'labels',
  'affected_projects',
  'monorepo_plan',
  'jev_provider',
  'jev_model',
  'jev_endpoint',
  'jev_timeout_ms',
  'jev_config_path',
  'min_confidence',
  'low_confidence_policy',
  'decision_only',
  'assign_reviewers',
  'auto_assign',
  'consider_availability',
  'consider_review_load',
  'include_commit_history',
  'history_lookback',
  'comment_on_github',
  'create_check_run',
  'telemetry',
  'cache_decisions',
  'trust_repo_jev_endpoint',
  'token',
  'dry_run',
] as const;

async function main(): Promise<void> {
  const token = core.getInput('token') || process.env.GITHUB_TOKEN;
  const octokit = token ? github.getOctokit(token) : null;

  await runAction({
    inputs: Object.fromEntries(INPUT_NAMES.map(name => [name, core.getInput(name)])),
    env: process.env,
    workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
    eventName: github.context.eventName,
    payload: github.context.payload as Record<string, unknown>,
    repo: github.context.repo,
    fetch: globalThis.fetch.bind(globalThis),
    info: message => core.info(message),
    warning: message => core.warning(message),
    setOutput: (name, value) => core.setOutput(name, value),
    setFailed: message => core.setFailed(message),
    summary: async markdown => {
      core.summary.addRaw(markdown);
      await core.summary.write();
    },
    octokit: octokit as never,
  });
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  const prefixed = message.startsWith('[JEV Reviewer Navigator]')
    ? message
    : `[JEV Reviewer Navigator] ${message}`;
  core.setFailed(prefixed);
});
