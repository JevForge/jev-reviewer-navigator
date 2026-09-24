import { sanitizePath, parseList } from '../utils/sanitize.js';

export interface PathCollection {
  paths: string[];
  truncated: boolean;
}

function normalizeList(raw: string[]): string[] {
  const unique = new Set<string>();
  for (const item of raw) {
    const path = sanitizePath(item);
    if (path && !path.includes('..')) unique.add(path);
  }
  return [...unique].slice(0, 500);
}

export function collectChangedPaths(
  input: string | undefined,
  payload: Record<string, unknown>,
): PathCollection {
  if (input?.trim()) {
    let items: string[] = [];
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) items = parsed.map(String);
      } catch {
        items = parseList(trimmed);
      }
    } else {
      items = parseList(trimmed);
    }
    const paths = normalizeList(items);
    return { paths, truncated: items.length > paths.length };
  }

  const pr = payload.pull_request as { changed_files?: number } | undefined;
  const files = payload.pull_request
    ? ((payload as { pull_request?: { files?: Array<{ filename?: string }> } }).pull_request
        ?.files ?? [])
    : [];

  // Event payloads rarely include files; callers should enrich via API.
  const fromPayload = files
    .map(f => f.filename)
    .filter((name): name is string => typeof name === 'string');

  if (fromPayload.length > 0) {
    const paths = normalizeList(fromPayload);
    return { paths, truncated: false };
  }

  void pr;
  return { paths: [], truncated: false };
}

export interface PullFilesClient {
  listFiles(pullNumber: number): Promise<Array<{ filename: string }>>;
}

export async function enrichPathsFromPull(
  current: PathCollection,
  pullNumber: number | null,
  client: PullFilesClient | null,
): Promise<PathCollection> {
  if (current.paths.length > 0 || !pullNumber || !client) return current;
  const files = await client.listFiles(pullNumber);
  const paths = normalizeList(files.map(f => f.filename));
  return { paths, truncated: files.length > paths.length };
}
