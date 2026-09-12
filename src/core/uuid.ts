import { randomUUID } from 'node:crypto';

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_GENERATION_ATTEMPTS = 10;

export function generateCanonicalUuid(): string {
  const uuid = randomUUID().toLowerCase();
  if (!isCanonicalUuid(uuid)) {
    throw new Error(`Generated UUID '${uuid}' is not canonical.`);
  }

  return uuid;
}

export function generateUnusedCanonicalUuid(
  existingUuids: ReadonlySet<string>,
  generateUuid: () => string = generateCanonicalUuid
): string {
  for (let attempt = 0; attempt < UUID_GENERATION_ATTEMPTS; attempt += 1) {
    const uuid = generateUuid();
    if (!isCanonicalUuid(uuid)) {
      throw new Error(`Generated UUID '${uuid}' is not canonical.`);
    }
    if (!existingUuids.has(uuid)) {
      return uuid;
    }
  }
  throw new Error('Unable to generate an unused external folder identifier.');
}

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID_PATTERN.test(value);
}
