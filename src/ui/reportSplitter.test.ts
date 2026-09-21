import {
  expect,
  it
} from 'vitest';

import { clampSplit } from './reportSplitter.ts';

it('clamps pane widths while preserving the default proportion', () => {
  expect(clampSplit(1000, 0.6)).toBe(600);
  expect(clampSplit(1000, 0)).toBe(320);
  expect(clampSplit(1000, 1)).toBe(680);
  expect(clampSplit(700, 0.6)).toBe(380);
});
