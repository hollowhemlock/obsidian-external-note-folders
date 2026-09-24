import type { App } from 'obsidian';

import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { openPluginSettings } from './openPluginSettings.ts';

describe('status restriction settings navigation', () => {
  it('opens settings and selects this plugin without changing configuration', () => {
    const calls: string[] = [];
    const app = { setting: { open: () => calls.push('open'), openTabById: (id: string) => calls.push(id) } } as unknown as App;
    openPluginSettings(app, 'external-note-folders');
    expect(calls).toEqual(['open', 'external-note-folders']);
  });

  it('gives manual navigation instructions when settings navigation is unavailable', () => {
    const open = vi.fn();
    expect(() => {
      openPluginSettings({ setting: { open } } as unknown as App, 'external-note-folders');
    }).toThrow('Template exclusion patterns');
    expect(open).not.toHaveBeenCalled();
  });
});
