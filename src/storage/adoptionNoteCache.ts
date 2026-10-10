const CACHE_LIMIT_BYTES = 16_777_216;
const BYTES_PER_CHARACTER = 2;

/** Workflow-local parse reuse. Callers must read and compare exact content every time. */
export class AdoptionNoteCache<T> {
  public get sizeBytes(): number {
    return this.bytes;
  }

  private bytes = 0;
  private readonly entries = new Map<string, { bytes: number; content: string; value: T }>();
  public constructor(private readonly limit = CACHE_LIMIT_BYTES) {}
  public clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  public get(key: string, content: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry?.content !== content) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  public set(key: string, content: string, value: T): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.bytes -= previous.bytes;
    }
    // Account UTF-16 retention as well as serialized result and key storage.
    const bytes = BYTES_PER_CHARACTER * (content.length + key.length + (JSON.stringify(value) ?? '').length);
    if (bytes > this.limit) {
      return;
    }
    while (this.bytes + bytes > this.limit) {
      const first = this.entries.entries().next().value;
      if (!first) {
        break;
      }
      this.entries.delete(first[0]);
      this.bytes -= first[1].bytes;
    }
    this.entries.set(key, { bytes, content, value: structuredClone(value) });
    this.bytes += bytes;
  }
}
