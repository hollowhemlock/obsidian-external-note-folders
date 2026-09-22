import {
  describe,
  expect,
  it
} from 'vitest';

import { LEAF_REPORT_CSS } from './leafStyles.ts';

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../gu)!.map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

describe('attention palette contrast', () => {
  it.each(['light', 'dark'])('keeps %s row text and outlines readable on solid colors', (theme) => {
    const rules = [...LEAF_REPORT_CSS.matchAll(new RegExp(`\\.theme-${theme} \\.exnf-leaf-report\\{([^}]+)\\}`, 'gu'))]
      .map((match) => match[1]!).join(';');
    const colors = rules.match(/--leaf-(?:row|hover)-(?:neutral|healthy|optional|review|conflict):#[a-f\d]{6}/giu)!
      .map((value) => value.split(':')[1]!);
    const foreground = /--leaf-row-text:(?<color>#[a-f\d]{6})/iu.exec(rules)!.groups!['color']!;
    expect(colors).toHaveLength(10);
    for (const color of colors) {
      const background = luminance(color);
      const ink = luminance(foreground);
      expect((Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(
    [
      ['light', ['#ffffff', '#f6f8fb', '#e5edf9']],
      ['dark', ['#20252c', '#282f39', '#354860']]
    ] as const
  )('keeps %s indicators at least 3:1 on normal and selected backgrounds', (theme, backgrounds) => {
    const palette = new RegExp(`\\.theme-${theme} \\.exnf-leaf-report\\{([^}]+)\\}`, 'u').exec(LEAF_REPORT_CSS)![1]!;
    const colors = palette.match(/--leaf-(?:neutral|healthy|optional|review|conflict):#[a-f\d]{6}/giu)!
      .map((value) => value.split(':')[1]!);
    expect(colors).toHaveLength(5);
    for (const color of colors) {
      for (const background of backgrounds) {
        const a = luminance(color);
        const b = luminance(background);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
