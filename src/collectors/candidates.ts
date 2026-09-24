import type { ReviewerCandidate } from '../schemas/navigator.js';
import type { HistoryAuthor } from './history.js';
import type { AvailabilitySignal } from './availability.js';
import type { LoadMetrics } from './load.js';
import { normalizeReviewerId } from '../utils/sanitize.js';

export interface BuildCandidatesInput {
  allowlist: string[];
  codeownersHits: Map<string, { paths: string[]; patterns: string[] }>;
  history: HistoryAuthor[];
  labelHints: Map<string, string[]>;
  componentMap: Record<string, string[]>;
  changedPaths: string[];
  authorLogin: string | null;
  excludeAuthor: boolean;
  availability: AvailabilitySignal[];
  loadMetrics: LoadMetrics;
}

function kindOf(id: string): 'user' | 'team' {
  return id.startsWith('team:') ? 'team' : 'user';
}

function pathsHitComponent(paths: string[], componentGlob: string): boolean {
  const needle = componentGlob.replace(/^\//, '').toLowerCase();
  return paths.some(p => p.toLowerCase().includes(needle) || p.toLowerCase().startsWith(needle));
}

/**
 * Build the allowlisted candidate set with evidence signals.
 * Candidates outside the allowlist are dropped (ALLOWLIST_FILTER).
 * When allowlist is empty, CODEOWNERS + history + maps seed a provisional allowlist.
 */
export function buildCandidates(input: BuildCandidatesInput): {
  candidates: ReviewerCandidate[];
  authorExcluded: string[];
  allowlistDerived: boolean;
} {
  const authorExcluded: string[] = [];
  const author = input.authorLogin ? normalizeReviewerId(input.authorLogin) : null;

  let allow = new Set(
    input.allowlist.map(normalizeReviewerId).filter((id): id is string => Boolean(id)),
  );
  let allowlistDerived = false;

  if (allow.size === 0) {
    allowlistDerived = true;
    for (const id of input.codeownersHits.keys()) allow.add(id);
    for (const h of input.history) allow.add(h.login);
    for (const id of input.labelHints.keys()) allow.add(id);
    for (const reviewers of Object.values(input.componentMap)) {
      for (const id of reviewers) {
        const n = normalizeReviewerId(id);
        if (n) allow.add(n);
      }
    }
  }

  const byId = new Map<string, ReviewerCandidate>();

  const ensure = (rawId: string): ReviewerCandidate | null => {
    const id = normalizeReviewerId(rawId);
    if (!id) return null;
    if (!allow.has(id)) return null;
    if (input.excludeAuthor && author && id === author) {
      if (!authorExcluded.includes(id)) authorExcluded.push(id);
      return null;
    }
    let candidate = byId.get(id);
    if (!candidate) {
      candidate = {
        id,
        kind: kindOf(id),
        signals: {
          codeowners_hit: false,
          path_history: false,
          label_hint: false,
          component_map: false,
          team_mapped: false,
          available: null,
          open_review_requests: null,
        },
      };
      byId.set(id, candidate);
    }
    return candidate;
  };

  for (const [id] of input.codeownersHits) {
    const c = ensure(id);
    if (c) c.signals.codeowners_hit = true;
  }

  for (const h of input.history) {
    const c = ensure(h.login);
    if (c) c.signals.path_history = true;
  }

  for (const [id] of input.labelHints) {
    const c = ensure(id);
    if (c) {
      c.signals.label_hint = true;
      if (id.startsWith('team:')) c.signals.team_mapped = true;
    }
  }

  for (const [component, reviewers] of Object.entries(input.componentMap)) {
    if (!pathsHitComponent(input.changedPaths, component)) continue;
    for (const reviewer of reviewers) {
      const c = ensure(reviewer);
      if (c) c.signals.component_map = true;
    }
  }

  // Include remaining allowlisted entries so Jev can still consider them.
  for (const id of allow) {
    ensure(id);
  }

  for (const signal of input.availability) {
    const c = byId.get(signal.id);
    if (c) c.signals.available = signal.available;
  }

  for (const [id, count] of Object.entries(input.loadMetrics)) {
    const c = byId.get(id);
    if (c) c.signals.open_review_requests = count;
  }

  const candidates = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { candidates, authorExcluded, allowlistDerived };
}
