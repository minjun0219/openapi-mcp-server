import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { OpenApiMcpConfig } from './config/schema.js';
import { defaultDiskCacheDir } from './config/defaults.js';
import { createFetcher } from './spec/fetcher.js';
import { createSpecRegistry, type SpecRegistry } from './spec/registry.js';
import { createDiskCache, createNoopDiskCache } from './cache/disk.js';
import { registerListSpecs } from './tools/list-specs.js';
import { registerListEnvironments } from './tools/list-environments.js';
import { registerListTags } from './tools/list-tags.js';
import { registerListEndpoints } from './tools/list-endpoints.js';
import { registerGetEndpoint } from './tools/get-endpoint.js';
import { registerRefreshSpec } from './tools/refresh-spec.js';
import { getLogger } from './util/logger.js';

export const SERVER_NAME = 'openapi-mcp';
export const SERVER_VERSION = '0.1.0';

export interface ServerHandle {
  server: McpServer;
  registry: SpecRegistry;
}

export interface BuildServerOptions {
  /** Directory of the loaded config file; used to resolve relative `file` source paths. */
  configDir?: string;
}

export function buildServer(
  config: OpenApiMcpConfig,
  options: BuildServerOptions = {},
): ServerHandle {
  const fetcher = createFetcher({
    timeoutMs: config.http?.timeoutMs,
    insecureTls: config.http?.insecureTls,
  });
  const diskCacheEnabled = config.cache?.diskCache ?? true;
  const diskCache = diskCacheEnabled
    ? createDiskCache(config.cache?.diskCachePath ?? defaultDiskCacheDir())
    : createNoopDiskCache();
  const registry = createSpecRegistry(config, fetcher, {
    diskCache,
    ...(options.configDir ? { configDir: options.configDir } : {}),
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Browse internal OpenAPI / Swagger specs. Start with list_specs, then list_endpoints (filter by spec/tag/method/keyword) and get_endpoint for full detail. Use refresh_spec to force a re-fetch.',
    },
  );

  registerListSpecs(server, registry);
  registerListEnvironments(server, registry);
  registerListTags(server, registry);
  registerListEndpoints(server, registry);
  registerGetEndpoint(server, registry);
  registerRefreshSpec(server, registry);

  return { server, registry };
}

export async function startStdioServer(
  config: OpenApiMcpConfig,
  options: BuildServerOptions = {},
): Promise<ServerHandle> {
  const handle = buildServer(config, options);
  const transport = new StdioServerTransport();
  await handle.server.connect(transport);
  getLogger().info(
    { specs: Object.keys(config.specs).length },
    'openapi-mcp connected over stdio',
  );
  return handle;
}
