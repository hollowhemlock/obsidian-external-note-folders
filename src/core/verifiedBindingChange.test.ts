import path from 'node:path';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { VerifiedBindingChange } from './verifiedBindingChange.ts';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildLeafReport } from './leafReport.ts';
import { mergeVerifiedEvidence } from './verifiedBindingChange.ts';

describe('verified evidence revisions', () => {
  it('retains prior UUID ownership but marks newly unreadable note evidence unchecked', () => {
    const original = auditFixture(1);
    const folder = original.folders[0]!;
    const relativePath = `${path.relative(original.externalRoot, folder).replaceAll('\\', '/')}.md`;
    const uuid = 'd03a808c-92b4-47be-825a-13fa489a11dc';
    const notePath = path.join(original.vaultRoot, relativePath);
    original.notes = [{ hasExnf: true, notePath, relativePath, status: 'valid', uuid, value: uuid }];
    original.markers = [{ folderPath: folder, format: 'uuid-named', markerPath: path.join(folder, `${uuid}.exnf`), status: 'valid', uuid }];
    const fresh = structuredClone(original);
    fresh.notes[0] = { ...fresh.notes[0]!, hasExnf: false, status: 'unchecked-frontmatter', uuid: '', value: '' };
    fresh.issues = [{ kind: 'note', location: notePath, reason: 'unreadable', scope: 'vault', unchecked: true }];
    const merged = mergeVerifiedEvidence(original, {
      affectedFolders: [folder],
      evidence: fresh,
      externalRoot: original.externalRoot,
      ignorePatterns: [],
      mutationRevision: 1,
      newNotePath: relativePath,
      oldNotePath: null,
      operationId: 'read-failure',
      templatePatterns: [],
      uuid,
      vaultRoot: original.vaultRoot,
      verifiedAt: fresh.finishedAt
    });
    expect(merged.notes[0]).toMatchObject({ status: 'unchecked-frontmatter', uuid });
    expect(merged.vault.bindings.has(uuid)).toBe(true);
    const node = buildLeafReport(merged).tree?.find((item) => item.folderPath === folder);
    expect(node?.evidence?.yaml).toBe('unchecked');
    expect(node?.evidence?.status).not.toBe('Bound at expected path');
  });
  it('retains omitted evidence and scope, replaces checked identities, and removes only established absences', () => {
    const original = auditFixture(2);
    original.statusScanMode = 'unfiltered';
    const folder = original.folders[0]!;
    const omitted = path.join(folder, 'ignored');
    const uuid = 'd03a808c-92b4-47be-825a-13fa489a11dc';
    original.markers = [
      { folderPath: omitted, format: 'uuid-named', markerPath: path.join(omitted, `${uuid}.exnf`), status: 'valid', uuid },
      { folderPath: folder, format: 'uuid-named', markerPath: path.join(folder, 'gone.exnf'), status: 'invalid-marker', uuid: '' }
    ];
    const before = structuredClone(original);
    const evidence = structuredClone(original);
    evidence.markers = [{ folderPath: folder, format: 'uuid-named', markerPath: path.join(folder, `${uuid}.exnf`), status: 'valid', uuid }];
    evidence.checkedDirectories = [{ entries: ['ignored', `${uuid}.exnf`], path: folder }];
    evidence.statusScanMode = 'filtered';
    const change: VerifiedBindingChange = {
      affectedFolders: [folder],
      evidence,
      externalRoot: original.externalRoot,
      ignorePatterns: [],
      mutationRevision: 1,
      newNotePath: 'note.md',
      oldNotePath: null,
      operationId: 'one',
      templatePatterns: [],
      uuid,
      vaultRoot: original.vaultRoot,
      verifiedAt: evidence.finishedAt
    };
    const merged = mergeVerifiedEvidence(original, change);
    expect(original).toEqual(before);
    expect(merged.statusScanMode).toBe('unfiltered');
    expect(merged.finishedAt).toBe(original.finishedAt);
    expect(merged.markers).toHaveLength(2);
    expect(merged.external.duplicatePaths.has(uuid)).toBe(true);
    expect(mergeVerifiedEvidence(merged, change)).toEqual(merged);
  });
});
