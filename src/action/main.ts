import { runNavigator } from '../run.js';
import {
  coalescePolicy,
  coalesceProvider,
  loadJeConfig,
  loadNavigatorConfig,
  mergeAllowlist,
  resolveEndpoint,
} from '../collectors/config.js';
import { collectChangedPaths, enrichPathsFromPull } from '../collectors/paths.js';
import { loadCodeowners, collectCodeownersHits } from '../collectors/codeowners.js';
import { collectPathHistory } from '../collectors/history.js';
import { collectLabels, mapLabelsToReviewers } from '../collectors/labels.js';
import { collectAvailability } from '../collectors/availability.js';
import { collectReviewLoad } from '../collectors/load.js';
import { buildCandidates } from '../collectors/candidates.js';
import { applyPolicyToAction } from '../github/outputs.js';
import { COMMENT_MARKER } from '../executors/comment.js';
import { credentialEnvName } from '../jev/contract.js';
import { parseList } from '../utils/sanitize.js';

export interface ActionContext {
  inputs: Record<string, string>;
  env: NodeJS.ProcessEnv;
  workspace: string;
  eventName: string;
  payload: Record<string, unknown>;
  repo: { owner: string; repo: string };
  fetch: typeof fetch;
  info: (message: string) => void;
  warning: (message: string) => void;
  setOutput: (name: string, value: string) => void;
  setFailed: (message: string) => void;
  summary?: (markdown: string) => Promise<void>;
  octokit?: {
    paginate: <T>(fn: unknown, params: Record<string, unknown>) => Promise<T[]>;
    rest: {
      pulls: {
        listFiles: unknown;
        listCommits?: unknown;
        requestReviewers: (params: Record<string, unknown>) => Promise<unknown>;
      };
      repos: {
        listCommits: (params: Record<string, unknown>) => Promise<{
          data: Array<{ author?: { login?: string } | null }>;
        }>;
      };
      issues: {
        createComment: (params: Record<string, unknown>) => Promise<unknown>;
        updateComment: (params: Record<string, unknown>) => Promise<unknown>;
        listComments: (params: Record<string, unknown>) => Promise<{
          data: Array<{ id: number; body?: string | null; user?: { type?: string } | null }>;
        }>;
      };
      checks: {
        create: (params: Record<string, unknown>) => Promise<unknown>;
      };
      orgs: {
        checkMembershipForUser: (params: Record<string, unknown>) => Promise<{ status: number }>;
      };
      search: {
        issuesAndPullRequests: (params: Record<string, unknown>) => Promise<{
          data: { total_count: number };
        }>;
      };
    };
  } | null;
}

function readBoolean(inputs: Record<string, string>, name: string, fallback: boolean): boolean {
  const raw = inputs[name];
  if (!raw) return fallback;
  return raw.toLowerCase() === 'true';
}

function resolveApiKey(provider: string, env: NodeJS.ProcessEnv): string | undefined {
  if (provider === 'vercel-ai-gateway') return env.AI_GATEWAY_API_KEY || undefined;
  if (provider === 'typesafe-native') return env.TYPESAFE_API_KEY || undefined;
  return env.JEV_CUSTOM_API_KEY || env.CUSTOM_JEV_API_KEY || undefined;
}

export async function runAction(ctx: ActionContext): Promise<void> {
  const started = Date.now();
  const jeConfig = loadJeConfig(ctx.workspace, ctx.inputs.jev_config_path || '.jev/config.yml');
  const navConfig = loadNavigatorConfig(
    ctx.workspace,
    ctx.inputs.config_path || '.jev/reviewer-navigator.yml',
  );

  const jevProvider = coalesceProvider(ctx.inputs.jev_provider, navConfig, jeConfig);
  const lowConfidencePolicy = coalescePolicy(
    ctx.inputs.low_confidence_policy,
    navConfig,
    jeConfig,
  );
  const minConfidence = Number(
    ctx.inputs.min_confidence || navConfig.min_confidence || jeConfig.min_confidence || 0.6,
  );
  const maxReviewers = Number(ctx.inputs.max_reviewers || navConfig.max_reviewers || 3);
  const timeoutMs = Number(ctx.inputs.jev_timeout_ms || 45_000);
  const decisionOnly = readBoolean(ctx.inputs, 'decision_only', true);
  const assignReviewers = readBoolean(ctx.inputs, 'assign_reviewers', false);
  const autoAssign = readBoolean(ctx.inputs, 'auto_assign', false);
  const dryRun = readBoolean(ctx.inputs, 'dry_run', true);
  const excludeAuthor = readBoolean(
    ctx.inputs,
    'exclude_author',
    navConfig.exclude_author ?? true,
  );
  const includeHistory = readBoolean(ctx.inputs, 'include_commit_history', true);
  const historyLookback = Number(ctx.inputs.history_lookback || 20);
  const considerAvailability = readBoolean(ctx.inputs, 'consider_availability', false);
  const considerReviewLoad = readBoolean(ctx.inputs, 'consider_review_load', false);
  const commentOnGithub = readBoolean(ctx.inputs, 'comment_on_github', false);
  const createCheckRun = readBoolean(ctx.inputs, 'create_check_run', false);
  const telemetry = readBoolean(ctx.inputs, 'telemetry', false);
  const trustRepoEndpoint = readBoolean(ctx.inputs, 'trust_repo_jev_endpoint', false);

  const jevEndpoint = resolveEndpoint({
    inputEndpoint: ctx.inputs.jev_endpoint,
    configEndpoint: navConfig.jev_endpoint || jeConfig.jev_endpoint,
    trustRepoEndpoint,
  });
  const jevModel = ctx.inputs.jev_model || navConfig.jev_model || jeConfig.jev_model;

  const pr = ctx.payload.pull_request as
    | {
        number?: number;
        user?: { login?: string };
        head?: { sha?: string };
      }
    | undefined;
  const pullNumber = pr?.number ?? null;
  const author = pr?.user?.login ?? null;
  const headSha =
    pr?.head?.sha ??
    (typeof ctx.payload.after === 'string' ? ctx.payload.after : null);

  let paths = collectChangedPaths(ctx.inputs.changed_paths, ctx.payload);
  if (ctx.octokit && pullNumber) {
    paths = await enrichPathsFromPull(paths, pullNumber, {
      async listFiles(num) {
        const files = await ctx.octokit!.paginate<{ filename: string }>(
          ctx.octokit!.rest.pulls.listFiles,
          {
            owner: ctx.repo.owner,
            repo: ctx.repo.repo,
            pull_number: num,
            per_page: 100,
          },
        );
        return files.map(f => ({ filename: f.filename }));
      },
    });
  }

  const codeowners = loadCodeowners(
    ctx.workspace,
    ctx.inputs.codeowners_path || navConfig.codeowners_path,
  );
  const codeownersHits = collectCodeownersHits(paths.paths, codeowners.rules);

  const history = await collectPathHistory(
    paths.paths,
    historyLookback,
    ctx.octokit
      ? {
          async listCommits(path, max) {
            const response = await ctx.octokit!.rest.repos.listCommits({
              owner: ctx.repo.owner,
              repo: ctx.repo.repo,
              path,
              per_page: max,
            });
            return response.data.map(c => ({
              authorLogin: c.author?.login ?? null,
            }));
          },
        }
      : null,
    includeHistory,
  );

  const labels = collectLabels(ctx.inputs.labels, ctx.payload);
  const labelHints = mapLabelsToReviewers(labels, navConfig.label_team_map);
  const allowlist = mergeAllowlist(navConfig.allowlist, ctx.inputs.allowlist);

  const draftCandidates = buildCandidates({
    allowlist,
    codeownersHits,
    history,
    labelHints,
    componentMap: navConfig.component_map,
    changedPaths: paths.paths,
    authorLogin: author,
    excludeAuthor,
    availability: [],
    loadMetrics: {},
  });

  const availability = await collectAvailability(
    draftCandidates.candidates.map(c => c.id),
    considerAvailability,
    ctx.octokit
      ? {
          async isOrgMember(login) {
            try {
              const result = await ctx.octokit!.rest.orgs.checkMembershipForUser({
                org: ctx.repo.owner,
                username: login,
              });
              return result.status === 204;
            } catch (error) {
              const status =
                error && typeof error === 'object' && 'status' in error
                  ? Number((error as { status?: number }).status)
                  : undefined;
              if (status === 404) return false;
              return null;
            }
          },
        }
      : null,
  );

  const load = await collectReviewLoad(
    draftCandidates.candidates.map(c => c.id),
    considerReviewLoad,
    ctx.octokit
      ? {
          async countOpenReviewRequests(login) {
            const result = await ctx.octokit!.rest.search.issuesAndPullRequests({
              q: `is:pr is:open review-requested:${login}`,
              per_page: 1,
            });
            return result.data.total_count;
          },
        }
      : null,
  );

  const { candidates, authorExcluded } = buildCandidates({
    allowlist,
    codeownersHits,
    history,
    labelHints,
    componentMap: navConfig.component_map,
    changedPaths: paths.paths,
    authorLogin: author,
    excludeAuthor,
    availability: availability.signals,
    loadMetrics: load.metrics,
  });

  ctx.info(`Jev provider: ${jevProvider} (credential env: ${credentialEnvName(jevProvider)})`);
  ctx.info(`Candidates: ${candidates.map(c => c.id).join(', ') || '(none)'}`);
  if (authorExcluded.length) {
    ctx.info(`Author excluded: ${authorExcluded.join(', ')}`);
  }
  ctx.info(
    'Data sent to Jev: changed path samples, labels, candidate ids with boolean evidence signals (CODEOWNERS/history/label/component/availability/load). Secrets, tokens, and file contents are never sent.',
  );

  const reviewerClient =
    ctx.octokit && pullNumber
      ? {
          async requestReviewers(input: { reviewers: string[]; teamReviewers: string[] }) {
            await ctx.octokit!.rest.pulls.requestReviewers({
              owner: ctx.repo.owner,
              repo: ctx.repo.repo,
              pull_number: pullNumber,
              reviewers: input.reviewers,
              team_reviewers: input.teamReviewers,
            });
          },
        }
      : null;

  const commentClient =
    ctx.octokit && pullNumber
      ? {
          async findExistingCommentId() {
            const comments = await ctx.octokit!.rest.issues.listComments({
              owner: ctx.repo.owner,
              repo: ctx.repo.repo,
              issue_number: pullNumber,
              per_page: 100,
            });
            const found = comments.data.find(
              c => c.user?.type === 'Bot' && c.body?.includes(COMMENT_MARKER),
            );
            return found?.id ?? null;
          },
          async createComment(body: string) {
            await ctx.octokit!.rest.issues.createComment({
              owner: ctx.repo.owner,
              repo: ctx.repo.repo,
              issue_number: pullNumber,
              body,
            });
          },
          async updateComment(commentId: number, body: string) {
            await ctx.octokit!.rest.issues.updateComment({
              owner: ctx.repo.owner,
              repo: ctx.repo.repo,
              comment_id: commentId,
              body,
            });
          },
        }
      : null;

  const checkRunClient = ctx.octokit
    ? {
        async createCheckRun(input: {
          name: string;
          headSha: string;
          conclusion: 'success' | 'neutral' | 'failure';
          title: string;
          summary: string;
        }) {
          await ctx.octokit!.rest.checks.create({
            owner: ctx.repo.owner,
            repo: ctx.repo.repo,
            name: input.name,
            head_sha: input.headSha,
            status: 'completed',
            conclusion: input.conclusion,
            output: { title: input.title, summary: input.summary },
          });
        },
      }
    : null;

  const result = await runNavigator({
    candidates,
    changedPaths: paths.paths,
    pathsTruncated: paths.truncated,
    labels,
    author,
    maxReviewers: Math.min(16, Math.max(1, maxReviewers)),
    minConfidence,
    lowConfidencePolicy,
    jevProvider,
    jevEndpoint,
    jevModel,
    timeoutMs: Math.min(120_000, Math.max(1_000, timeoutMs)),
    apiKey: resolveApiKey(jevProvider, ctx.env),
    fetchImpl: ctx.fetch,
    decisionOnly,
    assignReviewers,
    autoAssign,
    dryRun,
    commentOnGithub,
    createCheckRun,
    enableDeterministicFallback: true,
    headSha,
    availabilityStatus: availability.status,
    loadMetrics: load.metrics,
    reviewerClient,
    commentClient,
    checkRunClient,
  });

  applyPolicyToAction(
    {
      setOutput: ctx.setOutput,
      setFailed: ctx.setFailed,
      warning: ctx.warning,
      info: ctx.info,
    },
    result.outcome,
    {
      affectedPaths: paths.paths,
      assignStatus: result.assignStatus,
      availabilityStatus: result.availabilityStatus,
      loadMetrics: result.loadMetrics,
      dryRun,
    },
  );

  ctx.info(`Assign: ${result.assignStatus}`);
  ctx.info(`Comment: ${result.commentStatus}`);
  ctx.info(`Check run: ${result.checkStatus}`);

  if (ctx.summary) {
    await ctx.summary(
      [
        '## JEV Reviewer Navigator',
        '',
        `- Decision: \`${result.outcome.decision.decision}\``,
        `- Suggested: ${result.outcome.decision.suggested_reviewers.join(', ') || 'none'}`,
        `- Confidence: ${result.outcome.decision.confidence}`,
        `- Assign: ${result.assignStatus}`,
      ].join('\n'),
    );
  }

  if (telemetry) {
    ctx.info(
      JSON.stringify({
        event: 'jev_reviewer_navigator_telemetry',
        duration_ms: Date.now() - started,
        provider: jevProvider,
        provisional: result.outcome.decision.provisional,
        candidate_count: candidates.length,
        suggested_count: result.outcome.decision.suggested_reviewers.length,
        assign_status: result.assignStatus,
      }),
    );
  }

  void parseList;
}
