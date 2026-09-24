import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchPath } from '../utils/globs.js';
import { normalizeReviewerId } from '../utils/sanitize.js';

export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

export interface CodeownersMatch {
  path: string;
  owners: string[];
  pattern: string;
}

const DEFAULT_LOCATIONS = ['CODEOWNERS', 'docs/CODEOWNERS', '.github/CODEOWNERS'];

export function resolveCodeownersPath(
  workspace: string,
  preferred?: string,
): string | null {
  const candidates = preferred
    ? [preferred, ...DEFAULT_LOCATIONS.filter(p => p !== preferred)]
    : DEFAULT_LOCATIONS;
  for (const relative of candidates) {
    const full = join(workspace, relative);
    if (existsSync(full)) return relative;
  }
  return null;
}

export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const pattern = parts[0]!;
    const owners = parts
      .slice(1)
      .map(normalizeReviewerId)
      .filter((id): id is string => Boolean(id));
    if (owners.length === 0) continue;
    rules.push({ pattern, owners });
  }
  return rules;
}

export function loadCodeowners(
  workspace: string,
  preferred?: string,
): { path: string | null; rules: CodeownersRule[] } {
  const relative = resolveCodeownersPath(workspace, preferred);
  if (!relative) return { path: null, rules: [] };
  const text = readFileSync(join(workspace, relative), 'utf8');
  return { path: relative, rules: parseCodeowners(text) };
}

function codeownersMatch(path: string, pattern: string): boolean {
  const normalized = pattern.replace(/^\//, '');
  if (!normalized) return path.length > 0;
  // Directory rule: `/src/auth/` matches anything under that prefix.
  if (normalized.endsWith('/')) {
    return path === normalized.slice(0, -1) || path.startsWith(normalized);
  }
  if (matchPath(path, normalized) || matchPath(path, pattern)) return true;
  // Exact file rule without globs.
  if (!/[?*]/.test(normalized) && path === normalized) return true;
  return false;
}

/**
 * CODEOWNERS last-match-wins semantics.
 */
export function ownersForPath(path: string, rules: CodeownersRule[]): CodeownersMatch | null {
  let match: CodeownersMatch | null = null;
  for (const rule of rules) {
    if (codeownersMatch(path, rule.pattern)) {
      match = { path, owners: rule.owners, pattern: rule.pattern };
    }
  }
  return match;
}

export function collectCodeownersHits(
  paths: string[],
  rules: CodeownersRule[],
): Map<string, { paths: string[]; patterns: string[] }> {
  const byOwner = new Map<string, { paths: string[]; patterns: string[] }>();
  for (const path of paths) {
    const hit = ownersForPath(path, rules);
    if (!hit) continue;
    for (const owner of hit.owners) {
      const entry = byOwner.get(owner) ?? { paths: [], patterns: [] };
      if (!entry.paths.includes(path)) entry.paths.push(path);
      if (!entry.patterns.includes(hit.pattern)) entry.patterns.push(hit.pattern);
      byOwner.set(owner, entry);
    }
  }
  return byOwner;
}
