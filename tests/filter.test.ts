import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSpecText } from '../src/spec/parser.js';
import { indexSpec } from '../src/spec/indexer.js';
import { filterEndpoints } from '../src/search/filter.js';

const PETSTORE_3 = path.resolve('tests/fixtures/petstore-3.0.json');

async function loadEndpoints() {
  const raw = await readFile(PETSTORE_3, 'utf8');
  const { document } = await parseSpecText(raw);
  return indexSpec('petstore', document).endpoints;
}

describe('filterEndpoints', () => {
  it('filters by tag', async () => {
    const endpoints = await loadEndpoints();
    const tagFiltered = filterEndpoints(endpoints, { tag: 'store' });
    expect(tagFiltered.map((e) => e.path).sort()).toEqual(['/store/inventory', '/store/order']);
  });

  it('filters by HTTP method', async () => {
    const endpoints = await loadEndpoints();
    const posts = filterEndpoints(endpoints, { method: 'POST' });
    expect(posts.map((e) => e.path).sort()).toEqual(['/pet', '/store/order']);
  });

  it('keyword matches operationId, path, summary, description', async () => {
    const endpoints = await loadEndpoints();
    const hits = filterEndpoints(endpoints, { keyword: 'inventory' });
    expect(hits.map((e) => e.path)).toEqual(['/store/inventory']);
  });

  it('orders matches by where the keyword hits (operationId > path > summary)', async () => {
    const endpoints = await loadEndpoints();
    const ranked = filterEndpoints(endpoints, { keyword: 'pet' });
    expect(ranked[0]!.operationId).toBeDefined();
    // operationId-matching endpoints should come before pure path matches
    const firstWithOpId = ranked[0]!;
    expect(firstWithOpId.operationId?.toLowerCase().includes('pet')).toBe(true);
  });
});
