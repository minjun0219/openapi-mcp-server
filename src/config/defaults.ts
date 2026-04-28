import os from 'node:os';
import path from 'node:path';

export function defaultConfigPath(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'openapi-mcp', 'openapi-mcp.json');
}

export function defaultDiskCacheDir(): string {
  const xdg = process.env['XDG_CACHE_HOME'];
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.cache');
  return path.join(base, 'openapi-mcp');
}
