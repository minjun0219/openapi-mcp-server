import type {
  EnvironmentConfig,
  OpenApiMcpConfig,
  SpecConfig,
  SpecSource,
} from '../config/schema.js';
import { DEFAULT_CACHE_TTL_SECONDS } from '../config/schema.js';
import { parseSpecText } from './parser.js';
import { type SpecFetcher } from './fetcher.js';
import { indexSpec, type IndexedSpec } from './indexer.js';

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

export function createSpecRegistry(
  config: OpenApiMcpConfig,
  fetcher: SpecFetcher,
): SpecRegistry {
  return new InMemorySpecRegistry(config, fetcher);
}

class InMemorySpecRegistry implements SpecRegistry {
  private readonly cache = new Map<string, CachedSpec>();
  private readonly inFlight = new Map<string, Promise<IndexedSpec>>();

  constructor(
    private readonly config: OpenApiMcpConfig,
    private readonly fetcher: SpecFetcher,
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
    const cacheKey = this.cacheKey(specName, source);

    const cached = this.cache.get(cacheKey);
    if (cached) return cached.indexed;

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const promise = this.loadFresh(specName, source).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  async refresh(specName?: string): Promise<RefreshOutcome[]> {
    const targets = specName ? [specName] : Object.keys(this.config.specs);
    const outcomes: RefreshOutcome[] = [];
    for (const name of targets) {
      try {
        const spec = this.requireSpec(name);
        for (const envName of Object.keys(spec.environments)) {
          const source = this.resolveSource(name, spec, envName);
          const key = this.cacheKey(name, source);
          this.cache.delete(key);
          this.inFlight.delete(key);
        }
        const indexed = await this.loadSpec(name);
        const cached = this.cache.get(this.cacheKey(name, this.resolveSource(name, spec)));
        outcomes.push({
          spec: name,
          success: true,
          fetchedAt: cached?.fetchedAt ?? new Date().toISOString(),
        });
        void indexed;
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

  private async loadFresh(specName: string, source: SpecSource): Promise<IndexedSpec> {
    const fetched = await this.fetcher.fetch(source);
    if (fetched.notModified) {
      throw new Error(
        `unexpected 304 response for spec '${specName}' on initial load`,
      );
    }
    const parsed = await parseSpecText(fetched.body, source.format);
    const indexed = indexSpec(specName, parsed.document);
    this.cache.set(this.cacheKey(specName, source), {
      indexed,
      fetchedAt: fetched.fetchedAt,
      source,
    });
    return indexed;
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
