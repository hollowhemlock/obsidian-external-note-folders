import {
  describe,
  expect,
  it
} from 'vitest';

import {
  getExnfFrontmatterValue,
  setExnfFrontmatterValue
} from './frontmatter.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('frontmatter helpers', () => {
  it('returns missing when exnf is absent', () => {
    expect(getExnfFrontmatterValue({ title: 'Note' })).toEqual({ kind: 'missing' });
  });

  it('does not treat legacy exf frontmatter as a binding', () => {
    expect(getExnfFrontmatterValue({ exf: VALID_UUID })).toEqual({ kind: 'missing' });
  });

  it('returns a valid UUID when exnf is canonical', () => {
    expect(getExnfFrontmatterValue({ exnf: VALID_UUID })).toEqual({
      kind: 'valid',
      uuid: VALID_UUID
    });
  });

  it('rejects non-string exnf values', () => {
    expect(getExnfFrontmatterValue({ exnf: 42 })).toEqual({
      kind: 'invalid',
      reason: 'must be a string',
      value: 42
    });
  });

  it('rejects malformed UUID strings', () => {
    expect(getExnfFrontmatterValue({ exnf: 'not-a-uuid' })).toEqual({
      kind: 'invalid',
      reason: 'must be a canonical lowercase UUID',
      value: 'not-a-uuid'
    });
  });

  it('rejects non-canonical UUID strings', () => {
    expect(getExnfFrontmatterValue({ exnf: VALID_UUID.toUpperCase() })).toEqual({
      kind: 'invalid',
      reason: 'must be a canonical lowercase UUID',
      value: VALID_UUID.toUpperCase()
    });
  });

  it('writes a canonical UUID into frontmatter', () => {
    const frontmatter: Record<string, unknown> = {};
    setExnfFrontmatterValue(frontmatter, VALID_UUID);

    expect(frontmatter).toEqual({ exnf: VALID_UUID });
  });
});
