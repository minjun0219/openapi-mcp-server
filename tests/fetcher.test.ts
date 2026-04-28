import { describe, it, expect } from 'vitest';
import { createFetcher, SpecFetchError } from '../src/spec/fetcher.js';

describe('createFetcher TLS options', () => {
  it('surfaces extraCaCerts read failures with a clear error', async () => {
    const fetcher = createFetcher({
      extraCaCerts: ['/definitely/does/not/exist.pem'],
      timeoutMs: 1000,
    });
    await expect(
      fetcher.fetch({ type: 'url', url: 'https://example.invalid/spec.json' }),
    ).rejects.toMatchObject({
      name: 'SpecFetchError',
      message: expect.stringContaining('extraCaCerts'),
    });
  });

  it('reports a SpecFetchError when an unreachable URL is fetched', async () => {
    const fetcher = createFetcher({ timeoutMs: 100 });
    await expect(
      fetcher.fetch({ type: 'url', url: 'http://127.0.0.1:1/no-such-server' }),
    ).rejects.toBeInstanceOf(SpecFetchError);
  });
});
