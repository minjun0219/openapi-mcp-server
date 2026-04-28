import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { ZodError } from 'zod';
import { OpenApiMcpConfigSchema, type OpenApiMcpConfig } from './schema.js';

export class ConfigError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedConfig {
  config: OpenApiMcpConfig;
  path: string;
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const absolute = path.resolve(configPath);
  let raw: string;
  try {
    raw = await readFile(absolute, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`failed to read config file at ${absolute}: ${reason}`, err);
  }

  const parsed = parseByExtension(absolute, raw);
  try {
    const config = OpenApiMcpConfigSchema.parse(parsed);
    return { config, path: absolute };
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ConfigError(formatZodError(absolute, err), err);
    }
    throw err;
  }
}

function parseByExtension(filePath: string, raw: string): unknown {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`failed to parse JSON config at ${filePath}`, err);
    }
  }
  if (ext === '.yaml' || ext === '.yml') {
    try {
      return yaml.load(raw);
    } catch (err) {
      throw new ConfigError(`failed to parse YAML config at ${filePath}`, err);
    }
  }
  throw new ConfigError(
    `unsupported config extension '${ext}' at ${filePath} (expected .json, .yaml, .yml)`,
  );
}

function formatZodError(filePath: string, err: ZodError): string {
  const lines = err.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  - ${where}: ${issue.message}`;
  });
  return `invalid config at ${filePath}:\n${lines.join('\n')}`;
}
