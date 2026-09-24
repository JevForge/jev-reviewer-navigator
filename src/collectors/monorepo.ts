export interface MonorepoPlan {
  affected_projects: string[];
}

function cleanProjects(values: unknown[]): string[] {
  return [...new Set(
    values
      .map(value => String(value).trim().slice(0, 128))
      .filter(Boolean),
  )].slice(0, 100);
}

export function parseAffectedProjects(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return cleanProjects(parsed);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as MonorepoPlan).affected_projects)) {
      return cleanProjects((parsed as MonorepoPlan).affected_projects);
    }
  } catch {
    // Newline-separated input is also supported for convenient workflow usage.
  }
  return cleanProjects(raw.split(/[\r\n,]+/));
}

/**
 * Soft evidence: map affected monorepo projects to reviewers via project_reviewer_map
 * or component_map keys that match project names.
 */
export function reviewersFromMonorepoPlan(
  plan: MonorepoPlan | null,
  projectReviewerMap: Record<string, string[]>,
  componentMap: Record<string, string[]>,
): Map<string, string[]> {
  const hints = new Map<string, string[]>();
  if (!plan?.affected_projects?.length) return hints;

  for (const project of plan.affected_projects.slice(0, 100)) {
    const fromProject = projectReviewerMap[project] ?? [];
    const fromComponent =
      componentMap[project] ??
      Object.entries(componentMap).find(([key]) => project.includes(key) || key.includes(project))?.[1] ??
      [];
    for (const reviewer of [...fromProject, ...fromComponent]) {
      const entry = hints.get(reviewer) ?? [];
      if (!entry.includes(project)) entry.push(project);
      hints.set(reviewer, entry);
    }
  }
  return hints;
}

export function parseMonorepoPlan(raw: string | undefined): MonorepoPlan | null {
  const affected_projects = parseAffectedProjects(raw);
  return affected_projects.length ? { affected_projects } : null;
}
