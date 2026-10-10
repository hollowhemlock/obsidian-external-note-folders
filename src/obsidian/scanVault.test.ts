import type { App } from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import { scanVault } from './scanVault.ts';

describe('vault template exclusions', () => {
  it('uses the same scope for cached identities, duplicates, and invalid properties', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const files = [
      { path: 'Note.md', value: uuid },
      { path: 'nested/Note.tpl.md', value: uuid },
      { path: 'settings/templates/Note.md', value: 'invalid' },
      { path: 'settings/templates.archive/Note.md', value: uuid },
      { path: 'Ordinary.md', value: 'invalid' }
    ];
    const app = {
      metadataCache: { getFileCache: (file: { value: string }) => ({ frontmatter: { exnf: file.value } }) },
      vault: { getMarkdownFiles: () => files }
    } as unknown as App;
    const result = scanVault(app, ['*.tpl.md', '/settings/templates/', '/settings/templates.archive/']);
    expect([...result.bindings]).toEqual([[uuid, 'Note.md']]);
    expect(result.duplicatePaths.size).toBe(0);
    expect(result.invalidFrontmatter.map((item) => item.location)).toEqual(['Ordinary.md']);
    expect(scanVault(app).duplicatePaths.size).toBe(1);
    expect(() => scanVault(app, ['!invalid'])).toThrow('Invalid template');
  });
});
