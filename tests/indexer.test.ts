import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSpecText } from '../src/spec/parser.js';
import {
  buildEndpointDetail,
  indexSpec,
  resolveEndpoint,
} from '../src/spec/indexer.js';

const PETSTORE_3 = path.resolve('tests/fixtures/petstore-3.0.json');

async function loadIndexed() {
  const raw = await readFile(PETSTORE_3, 'utf8');
  const { document } = await parseSpecText(raw);
  return indexSpec('petstore', document);
}

describe('indexSpec', () => {
  it('indexes every operation in the petstore fixture', async () => {
    const spec = await loadIndexed();
    const ids = spec.endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(ids).toEqual([
      'DELETE /pet/{petId}',
      'GET /pet/{petId}',
      'GET /store/inventory',
      'POST /pet',
      'POST /store/order',
      'PUT /pet',
    ]);
  });

  it('exposes operationId index and synthetic fallback', async () => {
    const spec = await loadIndexed();
    expect(spec.byOperationId.get('addPet')?.path).toBe('/pet');
    const inventory = spec.byMethodPath.get('GET /store/inventory');
    expect(inventory?.operationId).toBeUndefined();
    expect(inventory?.syntheticOperationId).toBe('get_store_inventory');
  });

  it('marks deprecated endpoints', async () => {
    const spec = await loadIndexed();
    const del = spec.byOperationId.get('deletePet');
    expect(del?.deprecated).toBe(true);
  });

  it('counts tags correctly', async () => {
    const spec = await loadIndexed();
    const tagMap = new Map(spec.tags.map((t) => [t.name, t]));
    expect(tagMap.get('pet')?.endpointCount).toBe(4);
    expect(tagMap.get('store')?.endpointCount).toBe(2);
    expect(tagMap.get('pet')?.description).toBe('Operations about pets');
  });
});

describe('resolveEndpoint', () => {
  it('finds by operationId', async () => {
    const spec = await loadIndexed();
    expect(resolveEndpoint(spec, { operationId: 'getPetById' })?.path).toBe(
      '/pet/{petId}',
    );
  });
  it('finds by method+path', async () => {
    const spec = await loadIndexed();
    const ep = resolveEndpoint(spec, { method: 'post', path: '/pet' });
    expect(ep?.operationId).toBe('addPet');
  });
  it('finds by syntheticOperationId fallback', async () => {
    const spec = await loadIndexed();
    expect(
      resolveEndpoint(spec, { operationId: 'get_store_inventory' })?.path,
    ).toBe('/store/inventory');
  });
});

describe('buildEndpointDetail', () => {
  it('produces fully composed URL and merged parameters', async () => {
    const spec = await loadIndexed();
    const ep = spec.byOperationId.get('getPetById')!;
    const detail = buildEndpointDetail(spec, ep, 'https://api.dev/petstore');
    expect(detail.fullUrl).toBe('https://api.dev/petstore/pet/{petId}');
    expect(detail.parameters).toHaveLength(1);
    expect(detail.parameters[0]!.name).toBe('petId');
    expect(detail.parameters[0]!.in).toBe('path');
    expect(detail.parameters[0]!.required).toBe(true);
    expect(detail.responses['200']!.description).toBe('Successful operation');
    expect(detail.requestBody).toBeUndefined();
  });

  it('exposes request body content for POST endpoints', async () => {
    const spec = await loadIndexed();
    const ep = spec.byOperationId.get('addPet')!;
    const detail = buildEndpointDetail(spec, ep, 'https://api.dev/petstore');
    expect(detail.requestBody?.required).toBe(true);
    expect(detail.requestBody?.content['application/json']).toBeDefined();
    const schema = detail.requestBody?.content['application/json']?.schema as Record<string, unknown>;
    expect(schema['type']).toBe('object');
  });
});
