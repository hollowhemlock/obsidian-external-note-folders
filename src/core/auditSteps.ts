const MERGE_FACTOR = 2;

/** Drain pure analysis steps when scheduling is unnecessary (CLI and unit tests). */
export function finishAuditSteps<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/** Stable merge sort with scheduling points, including for a single very large group. */
export function* sortAuditSteps<T>(values: readonly T[], compare: (a: T, b: T) => number): Generator<void, T[]> {
  let source = [...values];
  for (let width = 1; width < source.length; width *= MERGE_FACTOR) {
    const target: T[] = [];
    for (let start = 0; start < source.length; start += width * MERGE_FACTOR) {
      let left = start;
      let right = Math.min(start + width, source.length);
      const leftEnd = right;
      const rightEnd = Math.min(start + width * MERGE_FACTOR, source.length);
      while (left < leftEnd || right < rightEnd) {
        const a = source[left];
        const b = source[right];
        if (left < leftEnd && (right >= rightEnd || (a !== undefined && b !== undefined && compare(a, b) <= 0))) {
          if (a !== undefined) {
            target.push(a);
          }
          left++;
        } else {
          if (b !== undefined) {
            target.push(b);
          }
          right++;
        }
        yield;
      }
    }
    source = target;
  }
  return source;
}
