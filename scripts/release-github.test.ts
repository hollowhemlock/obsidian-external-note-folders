import {
  describe,
  expect,
  it
} from 'vitest';

import type { GitHub } from './release-github.ts';

import { authenticatedActor } from './release-github.ts';

function responder(response: unknown): GitHub {
  return {
    request<T>(route: string, body?: Record<string, unknown>): Promise<T> {
      expect(route).toBe('POST /graphql');
      expect(body).toEqual({ query: 'query ReleaseSyncActor { viewer { login } }' });
      return Promise.resolve(response as T);
    }
  };
}

describe('authenticated release identity', () => {
  it.each(['release-maintainer', 'release-app[bot]'])('returns the token-authenticated login %s', async (login) => {
    expect(await authenticatedActor(responder({ data: { viewer: { login } } }))).toEqual({ login });
  });

  it.each([
    null,
    {},
    { data: null },
    { data: { viewer: null } },
    { data: { viewer: {} } },
    { data: { viewer: { login: '' } } },
    { data: { viewer: { login: '  ' } } },
    { data: { viewer: { login: ' release-maintainer' } } },
    { data: { viewer: { login: 42 } } },
    { errors: [{ message: 'Unauthorized' }] },
    { data: { viewer: { login: 'release-app[bot]' } }, errors: [{ message: 'Partial response' }] }
  ])('rejects missing, invalid or errored identity responses: %j', async (response) => {
    await expect(authenticatedActor(responder(response))).rejects.toThrow('Could not verify the authenticated');
  });

  it('propagates a transport failure without inventing an identity', async () => {
    const api: GitHub = { request: () => Promise.reject(new Error('HTTP 403')) };
    await expect(authenticatedActor(api)).rejects.toThrow('HTTP 403');
  });
});
