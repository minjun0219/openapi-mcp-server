import { describe, it, expect } from 'vitest';
import { joinBaseAndPath, syntheticOperationId } from '../src/util/url.js';

describe('joinBaseAndPath', () => {
  it('inserts a slash when missing', () => {
    expect(joinBaseAndPath('https://api.example.com', 'pet')).toBe(
      'https://api.example.com/pet',
    );
  });
  it('avoids double slashes', () => {
    expect(joinBaseAndPath('https://api.example.com/', '/pet')).toBe(
      'https://api.example.com/pet',
    );
    expect(joinBaseAndPath('https://api.example.com//', '//pet')).toBe(
      'https://api.example.com//pet',
    );
  });
  it('preserves path-style base URLs', () => {
    expect(joinBaseAndPath('https://api.example.com/v1', '/pet/{petId}')).toBe(
      'https://api.example.com/v1/pet/{petId}',
    );
  });
});

describe('syntheticOperationId', () => {
  it('drops braces and lowercases method', () => {
    expect(syntheticOperationId('GET', '/pet/{petId}')).toBe('get_pet_petId');
  });
  it('handles root path', () => {
    expect(syntheticOperationId('post', '/')).toBe('post_root');
  });
});
