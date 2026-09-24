import { parseList } from '../utils/sanitize.js';

export function collectLabels(
  input: string | undefined,
  payload: Record<string, unknown>,
): string[] {
  if (input?.trim()) {
    return [...new Set(parseList(input).map(l => l.toLowerCase()))].slice(0, 32);
  }
  const pr = payload.pull_request as { labels?: Array<{ name?: string } | string> } | undefined;
  const labels = (pr?.labels ?? [])
    .map(label => (typeof label === 'string' ? label : label.name))
    .filter((name): name is string => typeof name === 'string')
    .map(name => name.toLowerCase());
  return [...new Set(labels)].slice(0, 32);
}

export function mapLabelsToReviewers(
  labels: string[],
  labelTeamMap: Record<string, string[]>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const label of labels) {
    const mapped = labelTeamMap[label] ?? labelTeamMap[label.toLowerCase()];
    if (!mapped?.length) continue;
    for (const reviewer of mapped) {
      const entry = result.get(reviewer) ?? [];
      if (!entry.includes(label)) entry.push(label);
      result.set(reviewer, entry);
    }
  }
  return result;
}
