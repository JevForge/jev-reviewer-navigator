import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  JeConfigSchema,
  NavigatorConfigSchema,
  type JeConfig,
  type NavigatorConfig,
} from '../schemas/navigator.js';
import type { JevProviderId, LowConfidencePolicy } from '../schemas/enums.js';
import { normalizeReviewerId, parseList } from '../utils/sanitize.js';

export function loadYamlFile(workspace: string, relativePath: string): unknown {
  const full = join(workspace, relativePath);
  if (!existsSync(full)) return undefined;
  const text = readFileSync(full, 'utf8');
  return parseYaml(text);
}

export function loadJeConfig(workspace: string, path = '.jev/config.yml'): JeConfig {
  const raw = loadYamlFile(workspace, path);
  if (raw === undefined) return JeConfigSchema.parse({});
  return JeConfigSchema.parse(raw ?? {});
}

export function loadNavigatorConfig(
  workspace: string,
  path = '.jev/reviewer-navigator.yml',
): NavigatorConfig {
  const raw = loadYamlFile(workspace, path);
  if (raw === undefined) return NavigatorConfigSchema.parse({});
  return NavigatorConfigSchema.parse(raw ?? {});
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
  const fromInput = parseList(inputAllowlist)
    .map(normalizeReviewerId)
    .filter((id): id is string => Boolean(id));
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
