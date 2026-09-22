import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  expect,
  it
} from 'vitest';

import {
  assertAuditRoots,
  validateAuditDestination
} from './auditPaths.ts';

it('rejects unsupported roots and validates export directories without creating them', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exnf-audit-paths-'));
  try {
    expect(() => {
      assertAuditRoots(undefined, root);
    }).toThrow();
    expect(() => {
      assertAuditRoots('relative', root);
    }).toThrow();
    expect(() => {
      assertAuditRoots(root, 'relative');
    }).toThrow();
    expect(() => {
      assertAuditRoots(root, root);
    }).not.toThrow();
    expect(await validateAuditDestination(root)).toBe(root);
    await expect(validateAuditDestination('relative')).rejects.toThrow();
    await expect(validateAuditDestination(path.join(root, 'missing'))).rejects.toThrow();
    await writeFile(path.join(root, 'file'), '');
    await expect(validateAuditDestination(path.join(root, 'file'))).rejects.toThrow();
    await mkdir(path.join(root, 'child'));
    expect(await validateAuditDestination(path.join(root, 'child'))).toBe(path.join(root, 'child'));
  } finally {
    await cleanup(root);
  }
});

async function cleanup(root: string): Promise<void> {
  if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('exnf-audit-paths-')) {
    throw new Error('Unexpected cleanup path');
  }
  await rm(root, { force: true, recursive: true });
}
