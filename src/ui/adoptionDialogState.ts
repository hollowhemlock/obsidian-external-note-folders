import type { GroupAdoptionPlan } from '../core/groupAdoption.ts';

export type AdoptionMode = 'bind' | 'create' | 'move';
export type AdoptionPhase = 'checking' | 'error' | 'invalid' | 'ready';
export interface AdoptionPreview {
  content: null | string;
  plan: GroupAdoptionPlan;
}
const DEBOUNCE_MS = 400;

/** Owns preview lifetime independently of the modal and Obsidian. */
export class AdoptionDialogState {
  public acknowledged = false;
  public input = '';
  public message = '';
  public mode: AdoptionMode = 'create';
  public phase: AdoptionPhase = 'checking';
  public preview: AdoptionPreview | undefined;
  public source: null | string | undefined = null;
  public get canConfirm(): boolean {
    return this.phase === 'ready' && !!this.preview && (!this.preview.plan.descendants.length || this.acknowledged);
  }

  private abort: AbortController | undefined;
  private active = true;
  private generation = 0;
  private lastMode: 'bind' | 'move' = 'bind';
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly paths: () => string[],
    private readonly check: (source: null | string, move: boolean, signal: AbortSignal) => Promise<AdoptionPreview>,
    private readonly changed: () => void
  ) {}

  public activate(): void {
    this.active = true;
  }

  public chooseMode(mode: AdoptionMode): void {
    if (this.source === undefined || (mode === 'create') !== (this.source === null)) {
      return;
    }
    if (mode !== 'create') {
      this.lastMode = mode;
    }
    this.mode = mode;
    this.schedule();
  }

  public edit(input: string): void {
    this.input = input;
    const value = input.trim().replaceAll('\\', '/');
    const matches = this.paths().filter((candidate) => candidate === value || candidate === `${value}.md`);
    this.source = null;
    if (value) {
      this.source = matches.length === 1 ? matches[0] : undefined;
    }
    this.mode = this.source === null ? 'create' : this.lastMode;
    this.schedule();
  }

  public fail(message: string): void {
    this.invalidate();
    this.phase = 'error';
    this.message = message;
    this.changed();
  }

  public retry(): void {
    this.edit(this.input);
  }

  public start(): void {
    this.active = true;
    this.edit(this.input);
  }

  public stop(): void {
    this.active = false;
    this.invalidate();
  }

  private invalidate(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.acknowledged = false;
  }

  private isObsolete(revision: number): boolean {
    return !this.active || revision !== this.generation;
  }

  private schedule(): void {
    this.invalidate();
    this.phase = this.source === undefined ? 'invalid' : 'checking';
    this.message = '';
    this.changed();
    if (!this.active) {
      return;
    }
    const revision = this.generation;
    this.timer = setTimeout(() => {
      if (this.source === undefined) {
        this.message = 'Choose an existing note from the suggestions, correct the path, or clear this field to create a note.';
        this.changed();
        return;
      }
      const source = this.source;
      const move = this.mode === 'move';
      // A replacement waits for the cancelled request to settle before scanning.
      this.queue = this.queue.then(async () => {
        if (!this.active || revision !== this.generation) {
          return;
        }
        const abort = new AbortController();
        this.abort = abort;
        try {
          const result = await this.check(source, move, abort.signal);
          if (this.isObsolete(revision)) {
            return;
          }
          this.preview = result;
          this.phase = 'ready';
          this.message = 'Review the changes, then confirm adoption.';
        } catch (error: unknown) {
          if (this.isObsolete(revision)) {
            return;
          }
          this.phase = 'error';
          this.message = error instanceof Error ? error.message : String(error);
        }
        this.changed();
      });
    }, DEBOUNCE_MS);
  }
}
