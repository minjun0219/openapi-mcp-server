import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/server.js';
import type { OpenApiMcpConfig } from '../src/config/schema.js';

const PETSTORE_3 = path.resolve('tests/fixtures/petstore-3.0.json');

const config: OpenApiMcpConfig = {
  specs: {
    petstore: {
      description: 'Sample petstore',
      source: { type: 'file', path: PETSTORE_3 },
      environments: {
        dev: { baseUrl: 'https://api.dev.example.com/petstore' },
        stage: { baseUrl: 'https://api.stage.example.com/petstore' },
      },
    },
  },
};

let client: Client;

beforeAll(async () => {
  const { server } = buildServer(config);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'tools-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

async function callJson(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError ?? false).toBe(false);
  const items = result.content as Array<{ type: string; text: string }>;
  const content = items[0];
  if (!content) throw new Error(`tool ${name} returned no content`);
  expect(content.type).toBe('text');
  return JSON.parse(content.text);
}

describe('MCP tools', () => {
  it('lists registered tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_endpoint',
      'list_endpoints',
      'list_environments',
      'list_specs',
      'list_tags',
      'refresh_spec',
    ]);
  });

  it('list_specs reports declared environments and uncached status', async () => {
    const out = (await callJson('list_specs', {})) as {
      specs: Array<{ name: string; environments: string[]; cacheStatus: { cached: boolean } }>;
    };
    expect(out.specs).toHaveLength(1);
    expect(out.specs[0]!.environments).toEqual(['dev', 'stage']);
    expect(out.specs[0]!.cacheStatus.cached).toBe(false);
  });

  it('list_environments returns base URLs', async () => {
    const out = (await callJson('list_environments', { spec: 'petstore' })) as {
      environments: Array<{ name: string; baseUrl: string }>;
    };
    expect(out.environments).toHaveLength(2);
    expect(out.environments.find((e) => e.name === 'dev')?.baseUrl).toBe(
      'https://api.dev.example.com/petstore',
    );
  });

  it('list_tags returns endpoint counts', async () => {
    const out = (await callJson('list_tags', { spec: 'petstore' })) as {
      tags: Array<{ name: string; endpointCount: number }>;
    };
    const map = new Map(out.tags.map((t) => [t.name, t.endpointCount]));
    expect(map.get('pet')).toBe(4);
    expect(map.get('store')).toBe(2);
  });

  it('list_endpoints filters by tag', async () => {
    const out = (await callJson('list_endpoints', { tag: 'store' })) as {
      total: number;
      endpoints: Array<{ path: string }>;
    };
    expect(out.total).toBe(2);
    expect(out.endpoints.map((e) => e.path).sort()).toEqual([
      '/store/inventory',
      '/store/order',
    ]);
  });

  it('list_endpoints respects keyword and limit', async () => {
    const out = (await callJson('list_endpoints', {
      keyword: 'pet',
      limit: 2,
    })) as { total: number; returned: number; endpoints: Array<{ method: string }> };
    expect(out.returned).toBe(2);
    expect(out.total).toBeGreaterThanOrEqual(2);
  });

  it('get_endpoint by operationId returns full URL with environment base', async () => {
    const out = (await callJson('get_endpoint', {
      spec: 'petstore',
      environment: 'dev',
      operationId: 'getPetById',
    })) as { endpoint: { fullUrl: string; method: string; parameters: Array<{ name: string }> } };
    expect(out.endpoint.fullUrl).toBe(
      'https://api.dev.example.com/petstore/pet/{petId}',
    );
    expect(out.endpoint.method).toBe('GET');
    expect(out.endpoint.parameters[0]!.name).toBe('petId');
  });

  it('get_endpoint by method+path works', async () => {
    const out = (await callJson('get_endpoint', {
      spec: 'petstore',
      environment: 'stage',
      method: 'post',
      path: '/pet',
    })) as { endpoint: { operationId: string; fullUrl: string } };
    expect(out.endpoint.operationId).toBe('addPet');
    expect(out.endpoint.fullUrl).toBe('https://api.stage.example.com/petstore/pet');
  });

  it('get_endpoint returns error when unknown', async () => {
    const result = await client.callTool({
      name: 'get_endpoint',
      arguments: { spec: 'petstore', environment: 'dev', operationId: 'nope' },
    });
    expect(result.isError).toBe(true);
  });

  it('refresh_spec returns success outcome', async () => {
    const out = (await callJson('refresh_spec', { spec: 'petstore' })) as {
      refreshed: Array<{ spec: string; success: boolean }>;
    };
    expect(out.refreshed).toEqual([
      expect.objectContaining({ spec: 'petstore', success: true }),
    ]);
  });
});
