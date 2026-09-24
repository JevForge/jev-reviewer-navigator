import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restoreCache, saveCache } from '@actions/cache';
import { z } from 'zod';
import { NavigatorDecisionSchema, type NavigatorDecision } from '../schemas/navigator.js';
import type { PolicyOutcome } from './policy.js';
import { DECISIONS, JEV_PROVIDERS, REASON_CODES } from '../schemas/enums.js';

const CachedOutcomeSchema = z.object({
  status: z.enum(['ok', 'fail', 'warn', 'request-review', 'no-op']),
  message: z.string().optional(),
  decision: z.object({
    decision: z.enum(DECISIONS),
    suggested_reviewers: z.array(z.string()),
    ranked_reviewers: z.array(z.string()),
    confidence: z.number(),
    reason_codes: z.array(z.enum(REASON_CODES)),
    summary: z.string(),
    provisional: z.boolean(),
    provider: z.enum(JEV_PROVIDERS),
  }),
});

export function buildCacheKey(parts: {
  sha: string;
  configFingerprint: string;
  paths: string[];
  provider: string;
  maxReviewers: number;
  affectedProjects?: string[];
}): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        config: parts.configFingerprint,
        paths: [...parts.paths].sort(),
        provider: parts.provider,
        max: parts.maxReviewers,
        affectedProjects: [...(parts.affectedProjects ?? [])].sort(),
      }),
    )
    .digest('hex')
    .slice(0, 24);
  const sha = parts.sha.replace(/[^a-fA-F0-9]/g, '').slice(0, 40) || 'nosha';
  return `jev-rnav-v1-${sha}-${hash}`;
}

export function fingerprintConfig(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(raw ?? {})).digest('hex').slice(0, 32);
}

const FILE = 'decision.json';

export async function tryRestoreDecisionCache(input: {
  enabled: boolean;
  key: string;
  cacheDir: string;
}): Promise<PolicyOutcome | null> {
  if (!input.enabled) return null;
  mkdirSync(input.cacheDir, { recursive: true });
  const file = join(input.cacheDir, FILE);
  try {
    const hit = await restoreCache([input.cacheDir], input.key);
    if (!hit || !existsSync(file)) return null;
    const parsed = CachedOutcomeSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const decision = NavigatorDecisionSchema.parse(parsed.decision) as NavigatorDecision;
    if (parsed.status === 'fail') {
      return { status: 'fail', decision, message: parsed.message ?? decision.summary };
    }
    if (parsed.status === 'warn') {
      return { status: 'warn', decision, message: parsed.message ?? decision.summary };
    }
    if (parsed.status === 'request-review') {
      return { status: 'request-review', decision };
    }
    if (parsed.status === 'no-op') {
      return { status: 'no-op', decision, message: parsed.message ?? decision.summary };
    }
    return { status: 'ok', decision };
  } catch {
    return null;
  }
}

export async function saveDecisionCache(input: {
  enabled: boolean;
  key: string;
  cacheDir: string;
  outcome: PolicyOutcome;
}): Promise<boolean> {
  if (!input.enabled) return false;
  mkdirSync(input.cacheDir, { recursive: true });
  const file = join(input.cacheDir, FILE);
  const payload = CachedOutcomeSchema.parse({
    status: input.outcome.status,
    message: 'message' in input.outcome ? input.outcome.message : undefined,
    decision: input.outcome.decision,
  });
  writeFileSync(file, JSON.stringify(payload));
  try {
    await saveCache([input.cacheDir], input.key);
    return true;
  } catch {
    return false;
  }
}
