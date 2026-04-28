import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpecRegistry } from '../spec/registry.js';
import { UnknownSpecError } from '../spec/registry.js';
import { errorResult, jsonResult } from './responses.js';

const inputSchema = {
  spec: z.string().min(1).describe("Spec name (key from list_specs)."),
};

export function registerListEnvironments(server: McpServer, registry: SpecRegistry): void {
  server.registerTool(
    'list_environments',
    {
      title: 'List spec environments',
      description: 'Return the environments declared for a given spec, with their base URLs.',
      inputSchema,
    },
    async ({ spec }) => {
      try {
        return jsonResult({ spec, environments: registry.listEnvironments(spec) });
      } catch (err) {
        if (err instanceof UnknownSpecError) return errorResult(err.message);
        throw err;
      }
    },
  );
}
