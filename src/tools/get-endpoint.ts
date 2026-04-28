import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpecRegistry } from '../spec/registry.js';
import {
  UnknownEnvironmentError,
  UnknownSpecError,
} from '../spec/registry.js';
import { buildEndpointDetail, resolveEndpoint } from '../spec/indexer.js';
import { errorResult, jsonResult } from './responses.js';

const inputSchema = {
  spec: z.string().min(1).describe('Spec name.'),
  environment: z
    .string()
    .min(1)
    .describe('Environment name to use for base URL composition.'),
  operationId: z
    .string()
    .min(1)
    .optional()
    .describe('OpenAPI operationId or synthetic id (e.g., get_store_inventory).'),
  method: z
    .string()
    .min(1)
    .optional()
    .describe('HTTP method (case-insensitive). Required when operationId is omitted.'),
  path: z
    .string()
    .min(1)
    .optional()
    .describe('Path template (e.g., /pet/{petId}). Required when operationId is omitted.'),
};

export function registerGetEndpoint(server: McpServer, registry: SpecRegistry): void {
  server.registerTool(
    'get_endpoint',
    {
      title: 'Get endpoint detail',
      description:
        'Return full endpoint detail (parameters, request body, responses, examples, fullUrl) for a specific environment.',
      inputSchema,
    },
    async (args) => {
      try {
        if (!args.operationId && !(args.method && args.path)) {
          return errorResult(
            'must supply either operationId or both method and path to identify the endpoint',
          );
        }
        const env = registry.getEnvironment(args.spec, args.environment);
        const indexed = await registry.loadSpec(args.spec, args.environment);
        const ep = resolveEndpoint(indexed, args);
        if (!ep) {
          return errorResult(
            `endpoint not found in spec '${args.spec}' for ${formatLookup(args)}`,
          );
        }
        const detail = buildEndpointDetail(indexed, ep, env.baseUrl);
        return jsonResult({
          spec: args.spec,
          environment: args.environment,
          endpoint: detail,
        });
      } catch (err) {
        if (err instanceof UnknownSpecError) return errorResult(err.message);
        if (err instanceof UnknownEnvironmentError) return errorResult(err.message);
        throw err;
      }
    },
  );
}

function formatLookup(args: { operationId?: string; method?: string; path?: string }): string {
  if (args.operationId) return `operationId='${args.operationId}'`;
  return `${args.method?.toUpperCase()} ${args.path}`;
}
