import { randomUUID } from 'node:crypto';

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function generateCanonicalUuid(): string {
  const uuid = randomUUID().toLowerCase();
  if (!isCanonicalUuid(uuid)) {
    throw new Error(`Generated UUID '${uuid}' is not canonical.`);
  }

  return uuid;
}

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID_PATTERN.test(value);
}
