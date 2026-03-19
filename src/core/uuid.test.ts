import {
  describe,
  expect,
  it
} from 'vitest';

import {
  generateCanonicalUuid,
  isCanonicalUuid
} from './uuid.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('UUID helpers', () => {
  it('accepts canonical lowercase UUIDs', () => {
    expect(isCanonicalUuid(VALID_UUID)).toBe(true);
  });

  it('rejects uppercase UUIDs', () => {
    expect(isCanonicalUuid(VALID_UUID.toUpperCase())).toBe(false);
  });

  it('rejects malformed UUIDs', () => {
    expect(isCanonicalUuid('not-a-uuid')).toBe(false);
  });

  it('generates canonical lowercase UUIDs', () => {
    expect(isCanonicalUuid(generateCanonicalUuid())).toBe(true);
  });
});
