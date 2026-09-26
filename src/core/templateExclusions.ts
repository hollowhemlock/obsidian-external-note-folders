import { buildExternalRootIgnoreMatcher } from './externalRootIgnore.ts';

export interface TemplateExclusions {
  paths: string[];
  patterns: string[];
}

export function assertBindingNoteAllowed(notePath: string, patterns: readonly string[] = []): void {
  if (buildTemplateExclusionMatcher(patterns).ignoresRelativeFilePath(notePath)) {
    throw new Error(`Note is excluded from external-folder bindings by template exclusion patterns: ${notePath}`);
  }
}

export function buildTemplateExclusionMatcher(patterns: readonly string[] = []): ReturnType<typeof buildExternalRootIgnoreMatcher> {
  const matcher = buildExternalRootIgnoreMatcher('', patterns, { rootLabel: 'vault root' });
  if (matcher.errors.length) {
    throw new Error(`Invalid template exclusion patterns: ${matcher.errors.map((error) => `${error.pattern}: ${error.message}`).join('; ')}`);
  }
  return matcher;
}

export function templateExclusionSummary(exclusions: TemplateExclusions | undefined): string {
  return exclusions?.patterns.length
    ? `Template exclusions: ${String(exclusions.paths.length)} files or directory subtrees outside binding scope. Patterns: ${
      exclusions.patterns.join(', ')
    }. Excluded files cannot own bindings; coverage describes eligible notes only.`
    : '';
}
