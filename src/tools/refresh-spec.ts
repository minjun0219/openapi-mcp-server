import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpecRegistry } from '../spec/registry.js';
import { jsonResult } from './responses.js';

const inputSchema = {
  spec: z
    .string()
    .min(1)
    .optional()
    .describe('Spec name to refresh. When omitted, every spec is refreshed.'),
};

export function registerRefreshSpec(server: McpServer, registry: SpecRegistry): void {
  server.registerTool(
    'refresh_spec',
    {
      title: 'Refresh spec cache',
      description:
        'Drop the cached spec(s) and re-fetch from the configured source, ignoring ETag/Last-Modified.',
      inputSchema,
    },
    async ({ spec }) => {
      const refreshed = await registry.refresh(spec);
      return jsonResult({ refreshed });
    },
  );
}
