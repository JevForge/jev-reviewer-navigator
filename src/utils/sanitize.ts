export function sanitizeSummary(text: string, max = 500): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[`$\\]/g, '')
    .slice(0, max)
    .trim();
}

export function sanitizePath(repoPath: string): string {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\0/g, '').slice(0, 512);
}

export function normalizeReviewerId(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@/, '');
  if (!trimmed) return null;
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    const slug = parts[parts.length - 1];
    if (!slug) return null;
    return `team:${slug}`;
  }
  if (trimmed.startsWith('team:')) {
    return `team:${trimmed.slice('team:'.length).replace(/^@/, '')}`;
  }
  return trimmed;
}

export function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}
