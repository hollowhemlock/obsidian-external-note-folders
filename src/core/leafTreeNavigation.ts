import type { TreeResult } from './leafTree.ts';

/** A navigation reveal never changes matches, counts, or export rows. */
export function revealTreePath(result: TreeResult, id: string, sort: 'count' | 'name' = 'name'): TreeResult {
  const visible = new Set(result.visible);
  const children = new Map(result.children);
  let node = result.nodes.get(id);
  const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  while (node) {
    visible.add(node.id);
    const siblings = [...(children.get(node.parent) ?? [])];
    if (!siblings.includes(node.id)) {
      siblings.push(node.id);
      siblings.sort((a, b) =>
        (sort === 'count' ? (result.nodes.get(b)?.total ?? 0) - (result.nodes.get(a)?.total ?? 0) : 0)
        || names.compare(result.nodes.get(a)?.relativePath ?? a, result.nodes.get(b)?.relativePath ?? b)
      );
      children.set(node.parent, siblings);
    }
    node = result.nodes.get(node.parent ?? '');
  }
  return { ...result, children, visible };
}
