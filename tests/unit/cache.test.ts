import { describe, expect, it } from 'vitest';
import { buildCacheKey, fingerprintConfig } from '../../src/decision/cache.js';

describe('decision cache keys', () => {
  it('is stable for the same inputs', () => {
    const a = buildCacheKey({
      sha: 'abc123',
      configFingerprint: fingerprintConfig({ allowlist: ['alice'] }),
      paths: ['b.ts', 'a.ts'],
      provider: 'vercel-ai-gateway',
      maxReviewers: 3,
    });
    const b = buildCacheKey({
      sha: 'abc123',
      configFingerprint: fingerprintConfig({ allowlist: ['alice'] }),
      paths: ['a.ts', 'b.ts'],
      provider: 'vercel-ai-gateway',
      maxReviewers: 3,
    });
    expect(a).toBe(b);
    expect(a.startsWith('jev-rnav-v1-')).toBe(true);
  });

  it('changes when paths differ', () => {
    const a = buildCacheKey({
      sha: 'abc',
      configFingerprint: 'x',
      paths: ['a.ts'],
      provider: 'vercel-ai-gateway',
      maxReviewers: 3,
    });
    const b = buildCacheKey({
      sha: 'abc',
      configFingerprint: 'x',
      paths: ['b.ts'],
      provider: 'vercel-ai-gateway',
      maxReviewers: 3,
    });
    expect(a).not.toBe(b);
  });

  it('changes when affected monorepo projects differ', () => {
    const a = buildCacheKey({
      sha: 'abc',
      configFingerprint: 'x',
      paths: ['a.ts'],
      provider: 'vercel-ai-gateway',
      maxReviewers: 3,
      affectedProjects: ['apps/web'],
    });
    const b = buildCacheKey({
      sha: 'abc',
      configFingerprint: 'x',
      paths: ['a.ts'],
      provider: 'vercel-ai-gateway',
      maxReviewers: 3,
      affectedProjects: ['packages/auth'],
    });
    expect(a).not.toBe(b);
  });
});
