import type {
  EnvironmentConfig,
  OpenApiMcpConfig,
  SpecConfig,
  SpecSource,
} from '../config/schema.js';
import { DEFAULT_CACHE_TTL_SECONDS } from '../config/schema.js';
import { parseSpecObject, parseSpecText } from './parser.js';
import { type SpecFetcher } from './fetcher.js';
import { indexSpec, type IndexedSpec } from './indexer.js';
import { createNoopDiskCache, type DiskCache, type DiskCacheEntry } from '../cache/disk.js';
import { getLogger } from '../util/logger.js';

export interface SpecCacheStatus {
  cached: boolean;
  fetchedAt?: string;
  ttlSeconds: number;
}

export interface SpecSummary {
  name: string;
  description?: string;
  environments: string[];
  cacheStatus: SpecCacheStatus;
}

export interface ResolvedEnvironment {
  name: string;
  baseUrl: string;
  description?: string;
}

interface CachedSpec {
  indexed: IndexedSpec;
  fetchedAt: string;
  source: SpecSource;
  document: object;
  detectedFormat: 'openapi3' | 'swagger2';
  etag?: string;
  lastModified?: string;
  ttlSeconds: number;
}

export interface SpecRegistry {
  listSpecs(): SpecSummary[];
  listEnvironments(specName: string): ResolvedEnvironment[];
  loadSpec(specName: string, environment?: string): Promise<IndexedSpec>;
  getEnvironment(specName: string, environment: string): EnvironmentConfig;
  refresh(specName?: string): Promise<RefreshOutcome[]>;
  hasSpec(specName: string): boolean;
}

export interface RefreshOutcome {
  spec: string;
  success: boolean;
  fetchedAt?: string;
  error?: string;
}

export class UnknownSpecError extends Error {
  constructor(specName: string) {
    super(`unknown spec '${specName}'`);
    this.name = 'UnknownSpecError';
  }
}

export class UnknownEnvironmentError extends Error {
  constructor(specName: string, environment: string) {
    super(`unknown environment '${environment}' for spec '${specName}'`);
    this.name = 'UnknownEnvironmentError';
  }
}

export interface SpecRegistryOptions {
  diskCache?: DiskCache;
}

export function createSpecRegistry(
  config: OpenApiMcpConfig,
  fetcher: SpecFetcher,
  options: SpecRegistryOptions = {},
): SpecRegistry {
  return new InMemorySpecRegistry(config, fetcher, options.diskCache ?? createNoopDiskCache());
}

class InMemorySpecRegistry implements SpecRegistry {
  private readonly cache = new Map<string, CachedSpec>();
  private readonly inFlight = new Map<string, Promise<IndexedSpec>>();
  private readonly backgroundRefreshes = new Set<string>();

  constructor(
    private readonly config: OpenApiMcpConfig,
    private readonly fetcher: SpecFetcher,
    private readonly diskCache: DiskCache,
  ) {}

  hasSpec(specName: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.config.specs, specName);
  }

  listSpecs(): SpecSummary[] {
    return Object.entries(this.config.specs).map(([name, spec]) => ({
      name,
      description: spec.description,
      environments: Object.keys(spec.environments),
      cacheStatus: this.cacheStatus(name, spec),
    }));
  }

  listEnvironments(specName: string): ResolvedEnvironment[] {
    const spec = this.requireSpec(specName);
    return Object.entries(spec.environments).map(([name, env]) => ({
      name,
      baseUrl: env.baseUrl,
      description: env.description,
    }));
  }

  getEnvironment(specName: string, environment: string): EnvironmentConfig {
    const spec = this.requireSpec(specName);
    const env = spec.environments[environment];
    if (!env) throw new UnknownEnvironmentError(specName, environment);
    return env;
  }

  async loadSpec(specName: string, environment?: string): Promise<IndexedSpec> {
    const spec = this.requireSpec(specName);
    const source = this.resolveSource(specName, spec, environment);
    const ttlSeconds = spec.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
    const key = this.cacheKey(specName, source);

    const memHit = this.cache.get(key);
    if (memHit) {
      if (this.isStale(memHit)) this.scheduleBackgroundRefresh(specName, source, ttlSeconds);
      return memHit.indexed;
    }

    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    const promise = this.hydrateOrFetch(specName, source, ttlSeconds).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  async refresh(specName?: string): Promise<RefreshOutcome[]> {
    const targets = specName ? [specName] : Object.keys(this.config.specs);
    const outcomes: RefreshOutcome[] = [];
    for (const name of targets) {
      try {
        const spec = this.requireSpec(name);
        const ttlSeconds = spec.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
        const sourcesByKey = new Map<string, SpecSource>();
        sourcesByKey.set(this.cacheKey(name, spec.source), spec.source);
        for (const env of Object.values(spec.environments)) {
          if (env.source) {
            sourcesByKey.set(this.cacheKey(name, env.source), env.source);
          }
        }
        let fetchedAt: string | undefined;
        for (const [key, source] of sourcesByKey) {
          this.cache.delete(key);
          this.inFlight.delete(key);
          this.backgroundRefreshes.delete(key);
          await this.diskCache.delete(key);
          await this.fetchAndStore(name, source, ttlSeconds);
          fetchedAt = this.cache.get(key)?.fetchedAt ?? fetchedAt;
        }
        outcomes.push({
          spec: name,
          success: true,
          fetchedAt: fetchedAt ?? new Date().toISOString(),
        });
      } catch (err) {
        outcomes.push({
          spec: name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return outcomes;
  }

  private async hydrateOrFetch(
    specName: string,
    source: SpecSource,
    ttlSeconds: number,
  ): Promise<IndexedSpec> {
    const key = this.cacheKey(specName, source);
    const disk = await this.diskCache.read(key);
    if (disk) {
      try {
        const parsed = await parseSpecObject(disk.document, source.format);
        const indexed = indexSpec(specName, parsed.document);
        const cached: CachedSpec = {
          indexed,
          fetchedAt: disk.cachedAt,
          source,
          document: disk.document,
          detectedFormat: disk.detectedFormat,
          etag: disk.etag,
          lastModified: disk.lastModified,
          ttlSeconds,
        };
        this.cache.set(key, cached);
        if (this.isStale(cached)) this.scheduleBackgroundRefresh(specName, source, ttlSeconds);
        return indexed;
      } catch (err) {
        getLogger().warn(
          { err, spec: specName },
          'disk cache hydrate failed; falling back to fresh fetch',
        );
        await this.diskCache.delete(key);
      }
    }
    return this.fetchAndStore(specName, source, ttlSeconds);
  }

  private async fetchAndStore(
    specName: string,
    source: SpecSource,
    ttlSeconds: number,
  ): Promise<IndexedSpec> {
    const key = this.cacheKey(specName, source);
    const fetched = await this.fetcher.fetch(source);
    if (fetched.notModified) {
      throw new Error(`unexpected 304 response for spec '${specName}' on initial load`);
    }
    const parsed = await parseSpecText(fetched.body, source.format);
    const indexed = indexSpec(specName, parsed.document);
    const cached: CachedSpec = {
      indexed,
      fetchedAt: fetched.fetchedAt,
      source,
      document: parsed.document,
      detectedFormat: parsed.detectedFormat,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      ttlSeconds,
    };
    this.cache.set(key, cached);
    await this.diskCache.write(key, this.toDiskEntry(cached));
    return indexed;
  }

  private scheduleBackgroundRefresh(
    specName: string,
    source: SpecSource,
    ttlSeconds: number,
  ): void {
    const key = this.cacheKey(specName, source);
    if (this.backgroundRefreshes.has(key)) return;
    this.backgroundRefreshes.add(key);
    void this.runBackgroundRefresh(specName, source, ttlSeconds, key).finally(() => {
      this.backgroundRefreshes.delete(key);
    });
  }

  private async runBackgroundRefresh(
    specName: string,
    source: SpecSource,
    ttlSeconds: number,
    key: string,
  ): Promise<void> {
    const existing = this.cache.get(key);
    if (!existing) return;
    try {
      const conditional: { etag?: string; lastModified?: string } = {};
      if (existing.etag) conditional.etag = existing.etag;
      if (existing.lastModified) conditional.lastModified = existing.lastModified;
      const fetched = await this.fetcher.fetch(source, conditional);
      const current = this.cache.get(key);
      if (!current) return;
      if (fetched.notModified) {
        const refreshed: CachedSpec = { ...current, fetchedAt: fetched.fetchedAt, ttlSeconds };
        this.cache.set(key, refreshed);
        await this.diskCache.write(key, this.toDiskEntry(refreshed));
        return;
      }
      const parsed = await parseSpecText(fetched.body, source.format);
      if (Date.parse(fetched.fetchedAt) < Date.parse(current.fetchedAt)) {
        return;
      }
      const indexed = indexSpec(specName, parsed.document);
      const refreshed: CachedSpec = {
        indexed,
        fetchedAt: fetched.fetchedAt,
        source,
        document: parsed.document,
        detectedFormat: parsed.detectedFormat,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        ttlSeconds,
      };
      this.cache.set(key, refreshed);
      await this.diskCache.write(key, this.toDiskEntry(refreshed));
    } catch (err) {
      getLogger().warn(
        { err, spec: specName },
        'background refresh failed; serving stale cache',
      );
    }
  }

  private toDiskEntry(cached: CachedSpec): DiskCacheEntry {
    return {
      schemaVersion: 1,
      cachedAt: cached.fetchedAt,
      etag: cached.etag,
      lastModified: cached.lastModified,
      source: cached.source,
      detectedFormat: cached.detectedFormat,
      document: cached.document,
    };
  }

  private isStale(cached: CachedSpec): boolean {
    const age = (Date.now() - Date.parse(cached.fetchedAt)) / 1000;
    return age >= cached.ttlSeconds;
  }

  private cacheStatus(specName: string, spec: SpecConfig): SpecCacheStatus {
    const ttlSeconds = spec.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
    const defaultSource = this.resolveSource(specName, spec);
    const cached = this.cache.get(this.cacheKey(specName, defaultSource));
    if (cached) {
      return { cached: true, fetchedAt: cached.fetchedAt, ttlSeconds };
    }
    return { cached: false, ttlSeconds };
  }

  private resolveSource(
    specName: string,
    spec: SpecConfig,
    environment?: string,
  ): SpecSource {
    if (environment) {
      const env = spec.environments[environment];
      if (!env) throw new UnknownEnvironmentError(specName, environment);
      if (env.source) return env.source;
    }
    return spec.source;
  }

  private cacheKey(specName: string, source: SpecSource): string {
    return `${specName}::${source.type === 'url' ? source.url : source.path}`;
  }

  private requireSpec(specName: string): SpecConfig {
    const spec = this.config.specs[specName];
    if (!spec) throw new UnknownSpecError(specName);
    return spec;
  }
}
