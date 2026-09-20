import {
  describe,
  expect,
  it
} from 'vitest';

import { auditFixture } from '../../test/support/auditFixture.ts';
import { buildLeafReport } from '../core/leafReport.ts';
import {
  detailExplanations,
  folderAttention
} from './folderAttention.ts';

function node(): import('../core/leafTree.ts').LeafTreeNode {
  const row = buildLeafReport(auditFixture(1)).tree?.[0];
  if (!row?.evidence) {
    throw new Error('Missing fixture evidence');
  }
  return row;
}

describe('folder attention presentation', () => {
  it.each([
    ['Unassigned folder', 'neutral'],
    ['Inside a marked folder', 'neutral'],
    ['Contains bound subfolders', 'neutral'],
    ['Contains descendant markers', 'neutral'],
    ['Not present in scanned root', 'neutral'],
    ['Bound at expected path', 'healthy'],
    ['Bound at different path', 'review'],
    ['Expected path differs; bound elsewhere', 'review'],
    ['Marker absent here', 'review'],
    ['No matching note identity', 'review'],
    ['Unchecked', 'review'],
    ['Possible adoption candidate', 'optional'],
    ['Possible name matches', 'optional'],
    ['Identity conflict', 'conflict'],
    ['Ambiguous or invalid evidence', 'conflict']
  ])('maps %s to %s independently of blocked adoption', (status, expected) => {
    const row = node();
    row.evidence!.status = status;
    row.blocked = true;
    expect(folderAttention(row)).toBe(expected);
  });
  it('keeps ordinary containers neutral under incomplete identity coverage', () => {
    const row = node();
    row.evidence!.confidence = 'provisional';
    expect(folderAttention(row)).toBe('neutral');
    row.evidence!.status = 'Bound at expected path';
    expect(folderAttention(row)).toBe('review');
  });
  it.each(['excluded', 'link'] as const)('treats intentional %s coverage as informational', (kind) => {
    const row = node();
    row.kind = kind;
    row.unchecked = true;
    row.evidence!.status = 'Unchecked';
    expect(folderAttention(row)).toBe('neutral');
    row.conflict = true;
    expect(folderAttention(row)).toBe('conflict');
  });
  it('gives pending recovery precedence and requests review after changes', () => {
    const row = node();
    row.evidence!.status = 'Bound at expected path';
    expect(folderAttention(row, 'pending')).toBe('conflict');
    expect(folderAttention(row, 'changed')).toBe('review');
    row.evidence!.marker = 'invalid';
    expect(folderAttention(row)).toBe('conflict');
  });
  it('removes tag definitions from details while retaining source explanations for exports', () => {
    const row = node();
    row.evidence!.explanations.push('Unreadable marker at C:/external/.exnf');
    const before = [...row.evidence!.explanations];
    expect(detailExplanations(row)).toEqual(['Unreadable marker at C:/external/.exnf']);
    expect(row.evidence!.explanations).toEqual(before);
  });
});
