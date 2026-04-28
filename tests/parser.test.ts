import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSpecText, SpecParseError } from '../src/spec/parser.js';

const PETSTORE_3 = path.resolve('tests/fixtures/petstore-3.0.json');

describe('parseSpecText (OpenAPI 3.0)', () => {
  it('parses and dereferences a 3.0 JSON document', async () => {
    const raw = await readFile(PETSTORE_3, 'utf8');
    const result = await parseSpecText(raw);
    expect(result.detectedFormat).toBe('openapi3');
    expect(result.document.openapi).toMatch(/^3\./);
    const addPet = result.document.paths?.['/pet']?.post;
    expect(addPet?.operationId).toBe('addPet');
    const ref = (addPet?.requestBody as { content: Record<string, { schema: object }> })
      .content['application/json']!.schema as Record<string, unknown>;
    expect(ref['type']).toBe('object');
    expect(Object.keys((ref['properties'] as object) ?? {})).toEqual(
      expect.arrayContaining(['id', 'name', 'status']),
    );
  });

  it('throws when format hint disagrees with document', async () => {
    const raw = await readFile(PETSTORE_3, 'utf8');
    await expect(parseSpecText(raw, 'swagger2')).rejects.toBeInstanceOf(SpecParseError);
  });

  it('throws on documents missing both version markers', async () => {
    await expect(parseSpecText('{"info":{"title":"x"}}')).rejects.toBeInstanceOf(SpecParseError);
  });
});
