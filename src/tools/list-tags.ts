import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpecRegistry } from '../spec/registry.js';
import { UnknownSpecError } from '../spec/registry.js';
import { errorResult, jsonResult } from './responses.js';

const inputSchema = {
  spec: z.string().min(1).describe('Spec name to inspect.'),
};

export function registerListTags(server: McpServer, registry: SpecRegistry): void {
  server.registerTool(
    'list_tags',
    {
      title: 'List spec tags',
      description: "Return the spec's OpenAPI tags with endpoint counts.",
      inputSchema,
    },
    async ({ spec }) => {
      try {
        if (!registry.hasSpec(spec)) {
          return errorResult(`unknown spec '${spec}'`);
        }
        const indexed = await registry.loadSpec(spec);
        return jsonResult({ spec, tags: indexed.tags });
      } catch (err) {
        if (err instanceof UnknownSpecError) return errorResult(err.message);
        throw err;
      }
    },
  );
}
