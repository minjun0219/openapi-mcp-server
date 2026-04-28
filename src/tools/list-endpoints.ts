import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpecRegistry } from '../spec/registry.js';
import { UnknownSpecError } from '../spec/registry.js';
import { filterEndpoints, type EndpointFilter } from '../search/filter.js';
import { errorResult, jsonResult } from './responses.js';
import type { HttpMethod, IndexedEndpoint } from '../spec/indexer.js';

const HTTP_METHOD_VALUES = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE',
] as const;

const inputSchema = {
  spec: z
    .string()
    .min(1)
    .optional()
    .describe('If set, only search endpoints from this spec.'),
  tag: z.string().min(1).optional().describe('Filter by OpenAPI tag.'),
  method: z
    .enum(HTTP_METHOD_VALUES)
    .optional()
    .describe('Restrict to a single HTTP method.'),
  keyword: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Case-insensitive substring search across operationId, path, summary, and description.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe('Maximum endpoints to return (default 50, max 200).'),
};

export function registerListEndpoints(server: McpServer, registry: SpecRegistry): void {
  server.registerTool(
    'list_endpoints',
    {
      title: 'List endpoints',
      description:
        'Return summarised endpoints across one or all specs. Use spec/tag/method/keyword to narrow the result. Pair with get_endpoint for details.',
      inputSchema,
    },
    async (args) => {
      const limit = args.limit ?? 50;
      try {
        const targets = args.spec ? [args.spec] : registry.listSpecs().map((s) => s.name);
        const all: IndexedEndpoint[] = [];
        for (const name of targets) {
          if (!registry.hasSpec(name)) {
            return errorResult(`unknown spec '${name}'`);
          }
          const indexed = await registry.loadSpec(name);
          all.push(...indexed.endpoints);
        }
        const filter: EndpointFilter = {};
        if (args.spec) filter.spec = args.spec;
        if (args.tag) filter.tag = args.tag;
        if (args.method) filter.method = args.method as HttpMethod;
        if (args.keyword) filter.keyword = args.keyword;
        const filtered = filterEndpoints(all, filter);
        const truncated = filtered.slice(0, limit);

        return jsonResult({
          total: filtered.length,
          returned: truncated.length,
          endpoints: truncated.map((e) => ({
            spec: e.specName,
            operationId: e.operationId ?? e.syntheticOperationId,
            method: e.method,
            path: e.path,
            summary: e.summary,
            tags: e.tags,
            deprecated: e.deprecated,
          })),
        });
      } catch (err) {
        if (err instanceof UnknownSpecError) return errorResult(err.message);
        throw err;
      }
    },
  );
}
