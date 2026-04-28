import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpecRegistry } from '../spec/registry.js';
import { jsonResult } from './responses.js';

export function registerListSpecs(server: McpServer, registry: SpecRegistry): void {
  server.registerTool(
    'list_specs',
    {
      title: 'List OpenAPI specs',
      description:
        'List every OpenAPI spec configured in this MCP server, including their declared environments and current cache status.',
      inputSchema: {},
    },
    async () => jsonResult({ specs: registry.listSpecs() }),
  );
}
