import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDiskCache } from '../src/cache/disk.js';
import {
  createSpecRegistry,
  type SpecRegistry,
} from '../src/spec/registry.js';
import type {
  ConditionalHeaders,
  FetchOutcome,
  SpecFetcher,
} from '../src/spec/fetcher.js';
import type { OpenApiMcpConfig } from '../src/config/schema.js';

const PETSTORE_3 = path.resolve('tests/fixtures/petstore-3.0.json');

class ProgrammableFetcher implements SpecFetcher {
  fetchCount = 0;
  conditionalCalls: ConditionalHeaders[] = [];
  body: string;
  etag: string | undefined;
  notModifiedNext = false;
  bodyMutator?: (count: number) => string;

  constructor(body: string, opts: { etag?: string } = {}) {
    this.body = body;
    this.etag = opts.etag;
  }

  async fetch(_source: unknown, conditional?: ConditionalHeaders): Promise<FetchOutcome> {
    this.fetchCount += 1;
    this.conditionalCalls.push(conditional ?? {});
    if (this.notModifiedNext) {
      this.notModifiedNext = false;
      return {
        notModified: true,
        fetchedAt: new Date().toISOString(),
        source: { type: 'file', path: 'inline' },
      };
    }
    const body = this.bodyMutator ? this.bodyMutator(this.fetchCount) : this.body;
    return {
      notModified: false,
      body,
      etag: this.etag,
      fetchedAt: new Date().toISOString(),
      source: { type: 'file', path: 'inline' },
    };
  }
}

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openapi-mcp-cache-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeConfig(opts: { ttl?: number } = {}): OpenApiMcpConfig {
  return {
    specs: {
      petstore: {
        source: { type: 'file', path: PETSTORE_3 },
        environments: {
          dev: { baseUrl: 'https://api.dev.example.com/petstore' },
        },
        ...(opts.ttl !== undefined ? { cacheTtlSeconds: opts.ttl } : {}),
      },
    },
  };
}

async function loadAll(reg: SpecRegistry): Promise<void> {
  await reg.loadSpec('petstore', 'dev');
}

async function loadBody(): Promise<string> {
  return readFile(PETSTORE_3, 'utf8');
}

async function flushBackground(): Promise<void> {
  await new Promise((r) => setTimeout(r, 100));
}

describe('caching behaviour', () => {
  it('persists fetched specs to disk and re-hydrates on a fresh registry', async () => {
    const dir = makeTempDir();
    const disk = createDiskCache(dir);
    const body = await loadBody();
    const fetcher1 = new ProgrammableFetcher(body, { etag: 'v1' });
    const reg1 = createSpecRegistry(makeConfig(), fetcher1, { diskCache: disk });
    await loadAll(reg1);
    expect(fetcher1.fetchCount).toBe(1);

    const fetcher2 = new ProgrammableFetcher(body, { etag: 'v1' });
    const reg2 = createSpecRegistry(makeConfig({ ttl: 3600 }), fetcher2, { diskCache: disk });
    await loadAll(reg2);
    // Cache is fresh, so no fetch should happen.
    expect(fetcher2.fetchCount).toBe(0);
  });

  it('serves stale data and triggers background refresh with conditional headers', async () => {
    const dir = makeTempDir();
    const disk = createDiskCache(dir);
    const body = await loadBody();
    const fetcher = new ProgrammableFetcher(body, { etag: 'abc' });
    const reg = createSpecRegistry(makeConfig({ ttl: 1 }), fetcher, { diskCache: disk });
    await loadAll(reg);
    expect(fetcher.fetchCount).toBe(1);

    // Force the cache entry to look stale by waiting beyond the 1s TTL.
    await new Promise((r) => setTimeout(r, 1100));
    fetcher.notModifiedNext = true;
    await loadAll(reg);
    await flushBackground();

    expect(fetcher.fetchCount).toBe(2);
    expect(fetcher.conditionalCalls[1]).toEqual({ etag: 'abc' });
  });

  it('refresh_spec drops cache and re-fetches without conditional headers', async () => {
    const dir = makeTempDir();
    const disk = createDiskCache(dir);
    const body = await loadBody();
    const fetcher = new ProgrammableFetcher(body, { etag: 'v1' });
    const reg = createSpecRegistry(makeConfig({ ttl: 3600 }), fetcher, { diskCache: disk });
    await loadAll(reg);
    expect(fetcher.fetchCount).toBe(1);

    const result = await reg.refresh('petstore');
    expect(result[0]!.success).toBe(true);
    expect(fetcher.fetchCount).toBe(2);
    expect(fetcher.conditionalCalls[1]).toEqual({});
  });
});
