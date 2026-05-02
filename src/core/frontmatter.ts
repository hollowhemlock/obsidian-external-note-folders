import { EXF_FRONTMATTER_KEY } from './contracts.ts';
import { isCanonicalUuid } from './uuid.ts';

export type ExfFrontmatterValue =
  | { kind: 'invalid'; reason: string; value: unknown }
  | { kind: 'missing' }
  | { kind: 'valid'; uuid: string };

export function getExfFrontmatterValue(
  frontmatter: null | Record<string, unknown> | undefined
): ExfFrontmatterValue {
  if (!frontmatter || !Object.hasOwn(frontmatter, EXF_FRONTMATTER_KEY)) {
    return { kind: 'missing' };
  }

  const value = frontmatter[EXF_FRONTMATTER_KEY];
  if (typeof value !== 'string') {
    return {
      kind: 'invalid',
      reason: 'must be a string',
      value
    };
  }

  if (!isCanonicalUuid(value)) {
    return {
      kind: 'invalid',
      reason: 'must be a canonical lowercase UUID',
      value
    };
  }

  return {
    kind: 'valid',
    uuid: value
  };
}

export function setExfFrontmatterValue(frontmatter: Record<string, unknown>, uuid: string): void {
  if (!isCanonicalUuid(uuid)) {
    throw new Error('Expected a canonical lowercase UUID.');
  }

  frontmatter[EXF_FRONTMATTER_KEY] = uuid;
}
