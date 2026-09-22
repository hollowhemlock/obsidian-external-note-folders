import type { TreeResult } from './leafTree.ts';

const BINARY_DIVISOR = 2;

export interface IssueOrder {
  ids: string[];
  positions: Map<string, number>;
}
export function adjacentIssue(order: IssueOrder, selected: string | undefined, direction: -1 | 1): string | undefined {
  const position = selected ? order.positions.get(selected) : undefined;
  if (position === undefined) {
    return direction === 1 ? order.ids[0] : order.ids.at(-1);
  }
  // Binary search avoids traversing a large issue list on every selection.
  let low = 0;
  let high = order.ids.length;
  while (low < high) {
    const middle = Math.floor((low + high) / BINARY_DIVISOR);
    const at = order.positions.get(order.ids[middle] ?? '') ?? -1;
    if (at < position || (direction === 1 && at === position)) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return order.ids[direction === 1 ? low : low - 1];
}

/** Walk all matching branches, independent of expansion and windowed DOM rows. */
export function* issueOrderSteps(result: TreeResult): Generator<void, IssueOrder> {
  const ids: string[] = [];
  const positions = new Map<string, number>();
  // Retain hidden selection positions without making hidden entries issues.
  const stack = [...(result.orderedChildren.get(null) ?? [])].reverse();
  while (stack.length) {
    const id = stack.pop();
    if (id === undefined) {
      continue;
    }
    positions.set(id, positions.size);
    const attention = result.availability.get(id)?.attention;
    if (result.matched.has(id) && (attention === 'review' || attention === 'conflict')) {
      ids.push(id);
    }
    const children = result.orderedChildren.get(id) ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined) {
        stack.push(child);
      }
      yield;
    }
    yield;
  }
  return { ids, positions };
}
