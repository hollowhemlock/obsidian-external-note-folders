import {
  describe,
  expect,
  it
} from 'vitest';

import {
  assertBindingNoteAllowed,
  buildTemplateExclusionMatcher
} from './templateExclusions.ts';

describe('explicit template binding scope', () => {
  it('matches filename globs at any depth without excluding ordinary markdown', () => {
    const matcher = buildTemplateExclusionMatcher(['*.tpl.md']);
    expect(matcher.ignoresRelativeFilePath('note.tpl.md')).toBe(true);
    expect(matcher.ignoresRelativeFilePath('nested/note.tpl.md')).toBe(true);
    expect(matcher.ignoresRelativeFilePath('nested\\note.tpl.md')).toBe(true);
    expect(matcher.ignoresRelativeFilePath('nested/note.md')).toBe(false);
    expect(matcher.ignoresRelativeFilePath('nested/note.tpl.md.backup')).toBe(false);
  });

  it('anchors directory patterns to the vault root and preserves directory-only semantics', () => {
    const matcher = buildTemplateExclusionMatcher(['/settings/templates/', '/settings/templates.archive/']);
    expect(matcher.ignoresRelativeDirectoryPath('settings/templates')).toBe(true);
    expect(matcher.ignoresRelativeFilePath('settings/templates/deep/note.md')).toBe(true);
    expect(matcher.ignoresRelativeFilePath('settings/templates.archive/note.md')).toBe(true);
    expect(matcher.ignoresRelativeFilePath('nested/settings/templates/note.md')).toBe(false);
    expect(matcher.ignoresRelativeFilePath('settings/templates-other/note.md')).toBe(false);
    expect(matcher.ignoresRelativeFilePath('settings/templates')).toBe(false);
  });

  it('normalizes Windows patterns and ignores blank lines and comments', () => {
    const matcher = buildTemplateExclusionMatcher([' ', '# templates', '\\settings\\templates\\']);
    expect(matcher.patterns).toEqual(['/settings/templates/']);
    expect(matcher.ignoresRelativeFilePath('settings/templates/note.md')).toBe(true);
  });

  it.each(['!keep.md', 'C:\\templates\\', '//server/share/templates/'])('rejects invalid configuration: %s', (pattern) => {
    expect(() => buildTemplateExclusionMatcher([pattern])).toThrow('Invalid template exclusion patterns');
  });

  it('leaves binding scope unchanged by default and rejects excluded targets explicitly', () => {
    expect(() => {
      assertBindingNoteAllowed('note.tpl.md');
    }).not.toThrow();
    expect(() => {
      assertBindingNoteAllowed('note.tpl.md', ['*.tpl.md']);
    }).toThrow('excluded');
  });
});
