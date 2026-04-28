import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SpecSource } from '../config/schema.js';

export class SpecFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SpecFetchError';
  }
}

export interface FetchResult {
  body: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: string;
  notModified: false;
  source: SpecSource;
}

export interface NotModifiedResult {
  notModified: true;
  fetchedAt: string;
  source: SpecSource;
}

export type FetchOutcome = FetchResult | NotModifiedResult;

export interface ConditionalHeaders {
  etag?: string;
  lastModified?: string;
}

export interface FetcherOptions {
  timeoutMs?: number;
  insecureTls?: boolean;
}

export interface SpecFetcher {
  fetch(source: SpecSource, conditional?: ConditionalHeaders): Promise<FetchOutcome>;
}

export function createFetcher(options: FetcherOptions = {}): SpecFetcher {
  return new DefaultSpecFetcher(options);
}

class DefaultSpecFetcher implements SpecFetcher {
  constructor(private readonly options: FetcherOptions) {}

  async fetch(source: SpecSource, conditional?: ConditionalHeaders): Promise<FetchOutcome> {
    if (source.type === 'file') {
      return this.fetchFile(source);
    }
    return this.fetchUrl(source, conditional);
  }

  private async fetchFile(source: Extract<SpecSource, { type: 'file' }>): Promise<FetchResult> {
    const absolute = path.resolve(source.path);
    try {
      const body = await readFile(absolute, 'utf8');
      return {
        body,
        fetchedAt: new Date().toISOString(),
        notModified: false,
        source,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new SpecFetchError(`failed to read spec file ${absolute}: ${reason}`, undefined, err);
    }
  }

  private async fetchUrl(
    source: Extract<SpecSource, { type: 'url' }>,
    conditional?: ConditionalHeaders,
  ): Promise<FetchOutcome> {
    const { request } = await import('undici');
    const headers: Record<string, string> = {
      Accept: 'application/json, application/yaml;q=0.9, text/yaml;q=0.9, */*;q=0.1',
    };
    if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
    if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10_000,
    );

    try {
      const response = await request(source.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      const fetchedAt = new Date().toISOString();
      if (response.statusCode === 304) {
        await response.body.dump();
        return { notModified: true, fetchedAt, source };
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        await response.body.dump();
        throw new SpecFetchError(
          `unexpected HTTP ${response.statusCode} fetching ${source.url}`,
          response.statusCode,
        );
      }

      const body = await response.body.text();
      const etag = headerString(response.headers['etag']);
      const lastModified = headerString(response.headers['last-modified']);
      return {
        body,
        etag,
        lastModified,
        fetchedAt,
        notModified: false,
        source,
      };
    } catch (err) {
      if (err instanceof SpecFetchError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new SpecFetchError(`failed to fetch ${source.url}: ${reason}`, undefined, err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
