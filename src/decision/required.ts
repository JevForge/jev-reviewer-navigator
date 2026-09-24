import { matchPath } from '../utils/globs.js';
import { normalizeReviewerId } from '../utils/sanitize.js';

export interface RequiredReviewerRule {
  /** Path globs; empty means always applies. */
  paths: string[];
  /** Allowlisted reviewer ids — at least `min` must appear in suggestions. */
  any_of: string[];
  min: number;
}

/**
 * Deterministic floor: ensure required reviewers from matching path rules
 * are present in the suggestion list (appended, allowlist already assumed).
 */
export function applyRequiredReviewers(
  suggested: string[],
  changedPaths: string[],
  rules: RequiredReviewerRule[],
  maxReviewers: number,
  allowedReviewers?: Set<string>,
): { reviewers: string[]; applied: string[] } {
  const result = [...new Set(suggested)];
  const applied: string[] = [];
  const required = new Set<string>();

  for (const rule of rules) {
    const pathsMatch =
      rule.paths.length === 0 ||
      changedPaths.some(path =>
        rule.paths.some(glob => {
          const normalized = glob.replace(/^\//, '');
          return matchPath(path, glob) ||
            (normalized.endsWith('/') && path.startsWith(normalized));
        }),
      );
    if (!pathsMatch) continue;

    const needed = rule.any_of
      .map(normalizeReviewerId)
      .filter((id): id is string => {
        if (!id) return false;
        return !allowedReviewers || allowedReviewers.has(id);
      });
    for (const id of needed) required.add(id);
    const present = needed.filter(id => result.includes(id));
    let missing = Math.max(0, rule.min - present.length);
    for (const id of needed) {
      if (missing <= 0) break;
      if (result.includes(id)) continue;
      result.push(id);
      applied.push(id);
      missing -= 1;
    }
  }

  while (result.length > maxReviewers) {
    const removable = [...result].reverse().find(id => !required.has(id));
    if (!removable) break;
    result.splice(result.lastIndexOf(removable), 1);
  }

  return {
    reviewers: result.slice(0, maxReviewers),
    applied,
  };
}
