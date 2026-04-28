import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SpecSource } from '../config/schema.js';
import { getLogger } from '../util/logger.js';

export interface DiskCacheEntry {
  schemaVersion: 1;
  cachedAt: string;
  etag?: string;
  lastModified?: string;
  source: SpecSource;
  detectedFormat: 'openapi3' | 'swagger2';
  document: object;
}

export interface DiskCache {
  read(cacheKey: string): Promise<DiskCacheEntry | null>;
  write(cacheKey: string, entry: DiskCacheEntry): Promise<void>;
  delete(cacheKey: string): Promise<void>;
}

export interface NoopDiskCache extends DiskCache {}

export function createNoopDiskCache(): NoopDiskCache {
  return {
    async read() {
      return null;
    },
    async write() {
      /* noop */
    },
    async delete() {
      /* noop */
    },
  };
}

export function createDiskCache(dir: string): DiskCache {
  return new FsDiskCache(dir);
}

class FsDiskCache implements DiskCache {
  constructor(private readonly dir: string) {}

  async read(cacheKey: string): Promise<DiskCacheEntry | null> {
    const file = this.fileFor(cacheKey);
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as DiskCacheEntry;
      if (parsed.schemaVersion !== 1) {
        getLogger().debug({ cacheKey, file }, 'disk cache schemaVersion mismatch; ignoring');
        return null;
      }
      return parsed;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      getLogger().warn({ err, file }, 'failed to read disk cache entry');
      return null;
    }
  }

  async write(cacheKey: string, entry: DiskCacheEntry): Promise<void> {
    const file = this.fileFor(cacheKey);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, JSON.stringify(entry), 'utf8');
      const { rename } = await import('node:fs/promises');
      await rename(tmp, file);
    } catch (err) {
      getLogger().warn({ err, file }, 'failed to persist disk cache entry');
    }
  }

  async delete(cacheKey: string): Promise<void> {
    const file = this.fileFor(cacheKey);
    try {
      await rm(file, { force: true });
    } catch (err) {
      getLogger().debug({ err, file }, 'failed to delete disk cache entry');
    }
  }

  private fileFor(cacheKey: string): string {
    const hash = createHash('sha1').update(cacheKey).digest('hex').slice(0, 16);
    return path.join(this.dir, `${hash}.json`);
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
