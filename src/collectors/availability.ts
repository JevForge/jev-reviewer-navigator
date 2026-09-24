export type AvailabilityStatus = 'collected' | 'skipped' | 'unavailable';

export interface AvailabilitySignal {
  id: string;
  available: boolean | null;
  reason: 'member' | 'unknown' | 'team';
}

export interface AvailabilityClient {
  isOrgMember?(login: string): Promise<boolean | null>;
}

/**
 * Soft availability signals. Never invents OOO/busy status.
 * Users: optional org membership check. Teams: always null (unknown).
 */
export async function collectAvailability(
  candidateIds: string[],
  enabled: boolean,
  client: AvailabilityClient | null,
): Promise<{ status: AvailabilityStatus; signals: AvailabilitySignal[] }> {
  if (!enabled) return { status: 'skipped', signals: [] };
  if (!client) return { status: 'unavailable', signals: [] };

  const signals: AvailabilitySignal[] = [];
  for (const id of candidateIds.slice(0, 32)) {
    if (id.startsWith('team:')) {
      signals.push({ id, available: null, reason: 'team' });
      continue;
    }
    if (!client.isOrgMember) {
      signals.push({ id, available: null, reason: 'unknown' });
      continue;
    }
    try {
      const member = await client.isOrgMember(id);
      signals.push({
        id,
        available: member,
        reason: member === null ? 'unknown' : 'member',
      });
    } catch {
      signals.push({ id, available: null, reason: 'unknown' });
    }
  }
  return { status: 'collected', signals };
}
