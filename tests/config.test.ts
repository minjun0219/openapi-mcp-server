import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { loadConfig, ConfigError } from '../src/config/loader.js';

const FIXTURE_CONFIG = path.resolve('tests/fixtures/multi-spec-config.json');

describe('loadConfig', () => {
  it('parses a valid JSON config', async () => {
    const { config, path: resolved } = await loadConfig(FIXTURE_CONFIG);
    expect(resolved).toBe(FIXTURE_CONFIG);
    expect(Object.keys(config.specs)).toEqual(['petstore']);
    const petstore = config.specs['petstore']!;
    expect(petstore.source).toEqual({
      type: 'file',
      path: './tests/fixtures/petstore-3.0.json',
    });
    expect(Object.keys(petstore.environments)).toEqual(['dev', 'stage']);
    expect(petstore.environments['dev']!.baseUrl).toMatch(/^https:/);
    expect(petstore.cacheTtlSeconds).toBe(60);
    expect(config.http?.timeoutMs).toBe(5000);
  });

  it('parses YAML config by extension', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'openapi-mcp-cfg-'));
    const file = path.join(tmp, 'config.yaml');
    writeFileSync(
      file,
      [
        'specs:',
        '  petstore:',
        '    source:',
        '      type: file',
        '      path: ./spec.json',
        '    environments:',
        '      dev:',
        '        baseUrl: https://api.dev.example.com',
        '',
      ].join('\n'),
    );
    const { config } = await loadConfig(file);
    expect(config.specs['petstore']!.environments['dev']!.baseUrl).toBe(
      'https://api.dev.example.com',
    );
  });

  it('rejects empty specs map', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'openapi-mcp-cfg-'));
    const file = path.join(tmp, 'config.json');
    writeFileSync(file, JSON.stringify({ specs: {} }));
    await expect(loadConfig(file)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects spec with no environments', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'openapi-mcp-cfg-'));
    const file = path.join(tmp, 'config.json');
    writeFileSync(
      file,
      JSON.stringify({
        specs: {
          x: {
            source: { type: 'file', path: './a.json' },
            environments: {},
          },
        },
      }),
    );
    await expect(loadConfig(file)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects unsupported extension', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'openapi-mcp-cfg-'));
    const file = path.join(tmp, 'config.txt');
    writeFileSync(file, 'whatever');
    await expect(loadConfig(file)).rejects.toBeInstanceOf(ConfigError);
  });
});
