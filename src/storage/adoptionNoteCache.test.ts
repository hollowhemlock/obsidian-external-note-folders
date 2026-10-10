import {
  describe,
  expect,
  it
} from 'vitest';

import { AdoptionNoteCache } from './adoptionNoteCache.ts';

describe('workflow parse cache', () => {
  it('requires identical fresh content, isolates returned results, and evicts within its byte budget', () => {
    const cache = new AdoptionNoteCache<{ uuid: string }>(200);
    cache.set('a', 'original', { uuid: 'one' });
    expect(cache.get('a', 'edited')).toBeUndefined();
    const first = cache.get('a', 'original');
    first!.uuid = 'edited';
    expect(cache.get('a', 'original')?.uuid).toBe('one');
    cache.set('b', 'x'.repeat(60), { uuid: 'two' });
    cache.set('c', 'x'.repeat(60), { uuid: 'three' });
    expect(cache.get('a', 'original')).toBeUndefined();
    expect(cache.sizeBytes).toBeLessThanOrEqual(200);
    cache.set('huge', 'x'.repeat(1000), { uuid: 'huge' });
    expect(cache.get('huge', 'x'.repeat(1000))).toBeUndefined();
    cache.clear();
    expect(cache.sizeBytes).toBe(0);
  });
});
