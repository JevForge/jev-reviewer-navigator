export type AvailabilityStatus = 'collected' | 'skipped' | 'unavailable';

export interface AvailabilitySignal {
  id: string;
  available: boolean | null;
  reason: 'member' | 'unknown' | 'team';
}

export interface AvailabilityClient {
  isOrgMember?(login: string): Promise<boolean | null>;
}

export interface AvailabilitySource {
  readonly name: string;
  getAvailability(login: string): Promise<boolean | null>;
}

/**
 * Soft availability signals. Never invents OOO/busy status.
 * Users: optional org membership check. Teams: always null (unknown).
 */
export async function collectAvailability(
  candidateIds: string[],
  enabled: boolean,
  client: AvailabilityClient | AvailabilitySource | null,
): Promise<{ status: AvailabilityStatus; signals: AvailabilitySignal[] }> {
  if (!enabled) return { status: 'skipped', signals: [] };
  if (!client) return { status: 'unavailable', signals: [] };

  const signals: AvailabilitySignal[] = [];
  for (const id of candidateIds.slice(0, 32)) {
    if (id.startsWith('team:')) {
      signals.push({ id, available: null, reason: 'team' });
      continue;
    }
    const getAvailability = 'getAvailability' in client
      ? client.getAvailability.bind(client)
      : client.isOrgMember?.bind(client);
    if (!getAvailability) {
      signals.push({ id, available: null, reason: 'unknown' });
      continue;
    }
    try {
      const member = await getAvailability(id);
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
