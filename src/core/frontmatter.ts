import { EXNF_FRONTMATTER_KEY } from './contracts.ts';
import { isCanonicalUuid } from './uuid.ts';

export type ExnfFrontmatterValue =
  | { kind: 'invalid'; reason: string; value: unknown }
  | { kind: 'missing' }
  | { kind: 'valid'; uuid: string };

export function getExnfFrontmatterValue(
  frontmatter: null | Record<string, unknown> | undefined
): ExnfFrontmatterValue {
  if (!frontmatter || !Object.hasOwn(frontmatter, EXNF_FRONTMATTER_KEY)) {
    return { kind: 'missing' };
  }

  const value = frontmatter[EXNF_FRONTMATTER_KEY];
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

export function setExnfFrontmatterValue(frontmatter: Record<string, unknown>, uuid: string): void {
  if (!isCanonicalUuid(uuid)) {
    throw new Error('Expected a canonical lowercase UUID.');
  }

  frontmatter[EXNF_FRONTMATTER_KEY] = uuid;
}
