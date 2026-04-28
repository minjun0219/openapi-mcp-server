import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createSpecRegistry,
  UnknownSpecError,
  UnknownEnvironmentError,
} from '../src/spec/registry.js';
import type { SpecFetcher, FetchOutcome } from '../src/spec/fetcher.js';
import type { OpenApiMcpConfig } from '../src/config/schema.js';

const PETSTORE_3 = path.resolve('tests/fixtures/petstore-3.0.json');

class CountingFetcher implements SpecFetcher {
  fetchCount = 0;
  constructor(private readonly body: string) {}
  async fetch(): Promise<FetchOutcome> {
    this.fetchCount += 1;
    return {
      body: this.body,
      fetchedAt: new Date().toISOString(),
      notModified: false,
      source: { type: 'file', path: 'inline' },
    };
  }
}

let body: string;

beforeEach(async () => {
  body = await readFile(PETSTORE_3, 'utf8');
});

function makeConfig(envSource?: { type: 'file'; path: string }): OpenApiMcpConfig {
  return {
    specs: {
      petstore: {
        source: { type: 'file', path: PETSTORE_3 },
        environments: {
          dev: {
            baseUrl: 'https://api.dev.example.com/petstore',
            ...(envSource ? { source: envSource } : {}),
          },
          stage: { baseUrl: 'https://api.stage.example.com/petstore' },
        },
      },
    },
  };
}

describe('SpecRegistry', () => {
  it('lists specs with environment names and uncached status', () => {
    const reg = createSpecRegistry(makeConfig(), new CountingFetcher(body));
    const specs = reg.listSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0]!.name).toBe('petstore');
    expect(specs[0]!.environments).toEqual(['dev', 'stage']);
    expect(specs[0]!.cacheStatus.cached).toBe(false);
    expect(specs[0]!.cacheStatus.ttlSeconds).toBe(300);
  });

  it('lazily fetches and caches a spec on first load', async () => {
    const fetcher = new CountingFetcher(body);
    const reg = createSpecRegistry(makeConfig(), fetcher);
    await reg.loadSpec('petstore');
    await reg.loadSpec('petstore');
    expect(fetcher.fetchCount).toBe(1);
    const status = reg.listSpecs()[0]!.cacheStatus;
    expect(status.cached).toBe(true);
    expect(status.fetchedAt).toBeDefined();
  });

  it('deduplicates concurrent loads via in-flight promise', async () => {
    const fetcher = new CountingFetcher(body);
    const reg = createSpecRegistry(makeConfig(), fetcher);
    const [a, b] = await Promise.all([
      reg.loadSpec('petstore'),
      reg.loadSpec('petstore'),
    ]);
    expect(a).toBe(b);
    expect(fetcher.fetchCount).toBe(1);
  });

  it('throws UnknownSpecError for missing spec', async () => {
    const reg = createSpecRegistry(makeConfig(), new CountingFetcher(body));
    await expect(reg.loadSpec('missing')).rejects.toBeInstanceOf(UnknownSpecError);
  });

  it('throws UnknownEnvironmentError for missing environment', () => {
    const reg = createSpecRegistry(makeConfig(), new CountingFetcher(body));
    expect(() => reg.getEnvironment('petstore', 'prod')).toThrow(UnknownEnvironmentError);
  });

  it('uses environment-level source override when present', async () => {
    const fetcher = new CountingFetcher(body);
    // Override path is intentionally distinct so it gets its own cache key.
    const config = makeConfig({ type: 'file', path: '/tmp/dev-override.json' });
    const reg = createSpecRegistry(config, fetcher);
    await reg.loadSpec('petstore', 'dev');
    await reg.loadSpec('petstore', 'stage');
    expect(fetcher.fetchCount).toBe(2);
  });

  it('loads a Swagger 2.0 spec and serves it as OpenAPI 3', async () => {
    const swaggerBody = await readFile(
      path.resolve('tests/fixtures/petstore-2.0.json'),
      'utf8',
    );
    const fetcher = new CountingFetcher(swaggerBody);
    const reg = createSpecRegistry(makeConfig(), fetcher);
    const indexed = await reg.loadSpec('petstore', 'dev');
    expect(indexed.byOperationId.get('addPet')?.path).toBe('/pet');
    expect(indexed.document.openapi).toMatch(/^3\./);
  });

  it('refresh() clears cache and re-fetches', async () => {
    const fetcher = new CountingFetcher(body);
    const reg = createSpecRegistry(makeConfig(), fetcher);
    await reg.loadSpec('petstore');
    expect(fetcher.fetchCount).toBe(1);
    const result = await reg.refresh('petstore');
    expect(result[0]!.success).toBe(true);
    expect(fetcher.fetchCount).toBe(2);
  });
});
