import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  JeConfigSchema,
  NavigatorConfigSchema,
  type JeConfig,
  type NavigatorConfig,
  ReviewerIdSchema,
} from '../schemas/navigator.js';
import type { JevProviderId, LowConfidencePolicy } from '../schemas/enums.js';
import { normalizeReviewerId, parseList } from '../utils/sanitize.js';
import { ZodError } from 'zod';

export function loadYamlFile(workspace: string, relativePath: string): unknown {
  const full = join(workspace, relativePath);
  if (!existsSync(full)) return undefined;
  const text = readFileSync(full, 'utf8');
  return parseYaml(text);
}

export function loadJeConfig(workspace: string, path = '.jev/config.yml'): JeConfig {
  let raw: unknown;
  try {
    raw = loadYamlFile(workspace, path);
    if (raw === undefined) return JeConfigSchema.parse({});
    return JeConfigSchema.parse(raw ?? {});
  } catch (error) {
    throw formatConfigError(path, raw, error);
  }
}

export function loadNavigatorConfig(
  workspace: string,
  path = '.jev/reviewer-navigator.yml',
): NavigatorConfig {
  let raw: unknown;
  try {
    raw = loadYamlFile(workspace, path);
    if (raw === undefined) return NavigatorConfigSchema.parse({});
    return NavigatorConfigSchema.parse(raw ?? {});
  } catch (error) {
    throw formatConfigError(path, raw, error);
  }
}

function valueAtPath(raw: unknown, path: (string | number)[]): unknown {
  let current = raw as Record<string, unknown> | undefined;
  for (const part of path) {
    current = current?.[part as keyof typeof current] as Record<string, unknown> | undefined;
  }
  return current;
}

function formatConfigError(path: string, raw: unknown, error: unknown): Error {
  if (!(error instanceof ZodError)) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`Invalid reviewer config '${path}': ${message}`);
  }
  const details = error.issues.map(issue => {
    const location = issue.path.length ? issue.path.join('.') : '(root)';
    const value = valueAtPath(raw, issue.path);
    const hint = issue.path.some(
      part => String(part) === 'allowlist' || String(part) === 'any_of',
    )
      ? ` Invalid reviewer id '${String(value)}'; use a GitHub login or team:slug.`
      : '';
    return `${location}: ${issue.message}.${hint}`;
  });
  return new Error(`Invalid reviewer config '${path}': ${details.join(' ')}`);
}

export function coalesceProvider(
  input: string | undefined,
  nav: NavigatorConfig,
  je: JeConfig,
): JevProviderId {
  const value = (input || nav.jev_provider || je.jev_provider || 'vercel-ai-gateway').trim();
  if (
    value === 'vercel-ai-gateway' ||
    value === 'typesafe-native' ||
    value === 'custom-compatible'
  ) {
    return value;
  }
  throw new Error(`Unsupported jev_provider: ${value}`);
}

export function coalescePolicy(
  input: string | undefined,
  nav: NavigatorConfig,
  je: JeConfig,
): LowConfidencePolicy {
  const value = (input || nav.low_confidence_policy || je.low_confidence_policy || 'warn').trim();
  if (value === 'fail' || value === 'warn' || value === 'request-review' || value === 'no-op') {
    return value;
  }
  throw new Error(`Unsupported low_confidence_policy: ${value}`);
}

export function mergeAllowlist(
  configAllowlist: string[],
  inputAllowlist: string | undefined,
): string[] {
  const fromInput = parseList(inputAllowlist).map(raw => {
    const normalized = normalizeReviewerId(raw);
    if (raw.includes('/')) {
      const slug = raw.split('/').at(-1) || raw;
      throw new Error(`Invalid allowlist entry '${raw}'; use 'team:${slug}'.`);
    }
    if (!normalized || !ReviewerIdSchema.safeParse(normalized).success) {
      throw new Error(`Invalid allowlist entry '${raw}'; use a GitHub login or team:slug.`);
    }
    return normalized;
  });
  const merged = [...configAllowlist, ...fromInput];
  return [...new Set(merged)];
}

export function resolveEndpoint(params: {
  inputEndpoint?: string;
  configEndpoint?: string;
  trustRepoEndpoint: boolean;
}): string | undefined {
  if (params.inputEndpoint?.trim()) return params.inputEndpoint.trim();
  if (params.trustRepoEndpoint && params.configEndpoint?.trim()) {
    return params.configEndpoint.trim();
  }
  return undefined;
}
