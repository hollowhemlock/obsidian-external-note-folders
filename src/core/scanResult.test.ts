import {
  describe,
  expect,
  it
} from 'vitest';

import { registerUuidBinding } from './scanResult.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('scan result helpers', () => {
  it('records every duplicate binding path for the same UUID', () => {
    const bindings = new Map<string, string>();
    const duplicatePaths = new Map<string, string[]>();

    registerUuidBinding(bindings, duplicatePaths, VALID_UUID, 'Notes/A.md');
    registerUuidBinding(bindings, duplicatePaths, VALID_UUID, 'Notes/C.md');
    registerUuidBinding(bindings, duplicatePaths, VALID_UUID, 'Notes/B.md');

    expect(bindings).toEqual(new Map([[VALID_UUID, 'Notes/A.md']]));
    expect(duplicatePaths).toEqual(
      new Map([[VALID_UUID, [
        'Notes/A.md',
        'Notes/B.md',
        'Notes/C.md'
      ]]])
    );
  });
});
