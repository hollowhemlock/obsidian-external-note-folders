import {
  describe,
  expect,
  it
} from 'vitest';

import {
  getExfFrontmatterValue,
  setExfFrontmatterValue
} from './frontmatter.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('frontmatter helpers', () => {
  it('returns missing when exf is absent', () => {
    expect(getExfFrontmatterValue({ title: 'Note' })).toEqual({ kind: 'missing' });
  });

  it('returns a valid UUID when exf is canonical', () => {
    expect(getExfFrontmatterValue({ exf: VALID_UUID })).toEqual({
      kind: 'valid',
      uuid: VALID_UUID
    });
  });

  it('rejects non-string exf values', () => {
    expect(getExfFrontmatterValue({ exf: 42 })).toEqual({
      kind: 'invalid',
      reason: 'must be a string',
      value: 42
    });
  });

  it('rejects non-canonical UUID strings', () => {
    expect(getExfFrontmatterValue({ exf: VALID_UUID.toUpperCase() })).toEqual({
      kind: 'invalid',
      reason: 'must be a canonical lowercase UUID',
      value: VALID_UUID.toUpperCase()
    });
  });

  it('writes a canonical UUID into frontmatter', () => {
    const frontmatter: Record<string, unknown> = {};
    setExfFrontmatterValue(frontmatter, VALID_UUID);

    expect(frontmatter).toEqual({ exf: VALID_UUID });
  });
});
