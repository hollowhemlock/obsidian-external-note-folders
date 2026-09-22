import type { App } from 'obsidian';

import {
  Modal,
  Notice
} from 'obsidian';

import type { GroupAdoptionController } from './GroupAdoptionController.ts';

import {
  matchingNotePath,
  noteMatchReason
} from '../core/groupAdoption.ts';
import { AdoptionDialogState } from '../ui/adoptionDialogState.ts';

const CANDIDATE_LIMIT = 50;
let nextDialogId = 0;

export class GroupAdoptionModal extends Modal {
  private executing = false;
  private inspecting = false;
  private recovery: string | undefined;
  private refresh: (() => void) | undefined;
  private readonly state: AdoptionDialogState;

  public constructor(app: App, private readonly adoption: GroupAdoptionController, private readonly folder: string) {
    super(app);
    this.state = new AdoptionDialogState(
      () => adoption.choices().map((note) => note.path),
      (source, move, signal) => adoption.preview(folder, source, move, signal),
      () => {
        this.refresh?.();
      }
    );
  }

  public cancel(): void {
    this.inspecting = false;
    this.close();
  }

  public override onClose(): void {
    this.state.stop();
    if (!this.inspecting) {
      this.adoption.dismiss(this);
    }
    this.refresh = undefined;
    this.contentEl.empty();
  }

  public override onOpen(): void {
    this.modalEl.addClass('exnf-adoption-modal');
    this.contentEl.empty();
    this.contentEl.addClass('exnf-group-adoption');
    this.build();
    this.state.start();
  }

  private build(): void {
    const root = this.contentEl;
    root.createEl('h2', { text: 'Adopt this folder' });
    root.createEl('p', { text: `${this.folder}\nOne binding covers the entire subtree. External folders never move during adoption.` });
    const field = root.createDiv({ cls: 'exnf-adoption-field' });
    const listId = `exnf-note-options-${String(++nextDialogId)}`;
    const input = field.createEl('input', {
      attr: {
        'aria-autocomplete': 'list',
        'aria-controls': listId,
        'aria-expanded': 'false',
        'aria-label': 'Find note',
        'placeholder': 'Search or enter an existing note path; leave empty to create',
        'role': 'combobox',
        'type': 'search'
      }
    });
    input.value = this.state.input;
    const clear = field.createEl('button', { attr: { 'aria-label': 'Clear note field to create a new note' }, text: 'Clear' });
    const open = field.createEl('button', { text: 'Open note' });
    const suggestions = root.createDiv({ attr: { 'aria-label': 'Note suggestions', 'id': listId, 'role': 'listbox' }, cls: 'exnf-adoption-suggestions' });
    const help = root.createEl('p', { text: 'Clear the note field to create a new note at the matching folder path.' });
    const modes = root.createDiv({ attr: { 'aria-label': 'Adoption action', 'role': 'radiogroup' }, cls: 'exnf-adoption-modes' });
    const create = modes.createEl('button', { attr: { role: 'radio' }, text: 'Create new note' });
    const bind = modes.createEl('button', { attr: { role: 'radio' }, text: 'Bind without moving' });
    const move = modes.createEl('button', { attr: { role: 'radio' }, text: 'Move note to match folder' });
    const status = root.createEl('p', { attr: { 'aria-live': 'polite', 'role': 'status' } });
    const retry = root.createEl('button', { text: 'Retry checks' });
    const resume = root.createEl('button', { text: 'Resume folder adoption…' });
    const preview = root.createDiv({ attr: { 'aria-label': 'Adoption preview' }, cls: 'exnf-adoption-preview' });
    const summary = preview.createEl('dl');
    summary.createEl('dt', { text: 'Note' });
    const noteValue = summary.createEl('dd');
    summary.createEl('dt', { text: 'External folder' });
    summary.createEl('dd', { text: this.folder });
    summary.createEl('dt', { text: 'Changes' });
    const changes = summary.createEl('dd');
    const warnings = preview.createEl('p');
    const acknowledgment = preview.createEl('label');
    const checkbox = acknowledgment.createEl('input', { attr: { 'aria-label': 'Acknowledge descendant notes', 'type': 'checkbox' } });
    acknowledgment.createSpan({ text: ' I acknowledge these descendant notes remain unchanged and cannot have separate nested bindings.' });
    const descendants = preview.createEl('p');
    const technical = preview.createEl('details');
    technical.createEl('summary', { text: 'Technical details' });
    const technicalText = technical.createEl('p');
    const footer = root.createDiv({ cls: 'exnf-adoption-footer' });
    const close = footer.createEl('button', { text: 'Close' });
    const confirm = footer.createEl('button', { cls: 'mod-cta', text: 'Confirm adoption' });
    const controls = [input, clear, open, create, bind, move, retry, checkbox];
    let candidates: string[] = [];
    let active = -1;
    function hideSuggestions(): void {
      suggestions.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    const select = (value: string): void => {
      input.value = value;
      this.state.edit(value);
      hideSuggestions();
      input.focus();
    };
    const renderSuggestions = (): void => {
      suggestions.empty();
      const choices = this.adoption.choices().map((note) => ({ note, reason: noteMatchReason(note, this.folder, this.adoption.externalRoot(), input.value) }))
        .filter((choice) => choice.reason !== null).sort((a, b) =>
          Number(b.reason === 'Exact path') - Number(a.reason === 'Exact path') || a.note.path.localeCompare(b.note.path)
        );
      candidates = choices.slice(0, CANDIDATE_LIMIT).map((choice) => choice.note.path);
      for (const [index, choice] of choices.slice(0, CANDIDATE_LIMIT).entries()) {
        const option = suggestions.createDiv({
          attr: { 'aria-selected': 'false', 'id': `${listId}-${String(index)}`, 'role': 'option' },
          text: `${choice.note.path} — ${choice.reason ?? ''}`
        });
        option.onmousedown = (event): void => {
          event.preventDefault();
        };
        option.onclick = (): void => {
          select(choice.note.path);
        };
      }
      if (!candidates.length) {
        suggestions.createEl('p', { text: 'No matching notes. Try another name or clear the field to create a note.' });
      }
      if (choices.length > CANDIDATE_LIMIT) {
        suggestions.createEl('p', { text: 'Showing 50 matches. Refine your search.' });
      }
      suggestions.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
      input.removeAttribute('aria-activedescendant');
    };
    input.oninput = (): void => {
      this.state.edit(input.value);
      renderSuggestions();
    };
    input.onfocus = renderSuggestions;
    input.onblur = (): void => {
      hideSuggestions();
    };
    input.onkeydown = (event): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideSuggestions();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const value = candidates[active];
        if (!suggestions.hidden && value) {
          select(value);
        }
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (suggestions.hidden) {
          renderSuggestions();
        }
        active = Math.max(0, Math.min(candidates.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
        for (const [index, option] of Array.from(suggestions.querySelectorAll('[role=option]')).entries()) {
          option.setAttribute('aria-selected', String(index === active));
        }
        if (candidates[active]) {
          input.setAttribute('aria-activedescendant', `${listId}-${String(active)}`);
          suggestions.children[active]?.scrollIntoView({ block: 'nearest' });
        }
      }
    };
    clear.onclick = (): void => {
      select('');
    };
    open.onclick = (): void => {
      this.inspect().catch((error: unknown) => {
        new Notice(String(error));
      });
    };
    const buttons = [create, bind, move];
    const values = ['create', 'bind', 'move'] as const;
    for (const [index, button] of buttons.entries()) {
      button.onclick = (): void => {
        this.state.chooseMode(values[index] ?? 'create');
      };
      button.onkeydown = (event): void => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
          return;
        }
        event.preventDefault();
        const available = buttons.filter((candidate) => !candidate.disabled);
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const next = available[(available.indexOf(button) + offset + available.length) % available.length];
        next?.click();
        next?.focus();
      };
    }
    retry.onclick = (): void => {
      this.state.retry();
    };
    resume.onclick = (): void => {
      this.adoption.showRecovery(this.recovery).then(() => {
        this.close();
      }).catch((error: unknown) => {
        status.textContent = String(error);
      });
    };
    checkbox.onchange = (): void => {
      this.state.acknowledged = checkbox.checked;
      this.refresh?.();
    };
    close.onclick = (): void => {
      this.close();
    };
    confirm.onclick = (): void => {
      this.confirm().catch((error: unknown) => {
        this.executing = false;
        this.state.fail(String(error));
      });
    };
    this.refresh = (): void => {
      const state = this.state;
      const locked = this.executing || !!this.recovery;
      for (const control of controls) {
        control.disabled = locked;
      }
      create.disabled ||= state.source !== null;
      bind.disabled ||= !state.source;
      move.disabled ||= !state.source;
      open.disabled ||= !state.source;
      for (const [index, button] of buttons.entries()) {
        const checked = state.source !== undefined && state.mode === values[index];
        button.setAttribute('aria-checked', String(checked));
        button.tabIndex = checked ? 0 : -1;
      }
      input.setAttribute('aria-invalid', String(state.phase === 'invalid' && !!state.message));
      help.textContent = state.phase === 'invalid' && state.message ? state.message : 'Clear the note field to create a new note at the matching folder path.';
      status.textContent = this.executing
        ? 'Adopting… Wait for completion; Obsidian may ask whether to update links.'
        : state.message || (state.phase === 'checking' ? 'Checking… Previous preview is outdated.' : 'Choose a note or clear the field.');
      retry.hidden = state.phase !== 'error' || !!this.recovery;
      resume.hidden = !this.recovery;
      confirm.disabled = locked || !state.canConfirm;
      checkbox.checked = state.acknowledged;
      checkbox.disabled ||= state.phase !== 'ready';
      preview.setAttribute('aria-busy', String(state.phase === 'checking'));
      preview.classList.toggle('is-outdated', state.phase !== 'ready');
      renderPreview();
    };
    const renderPreview = (): void => {
      const state = this.state;
      const plan = state.preview?.plan;
      noteValue.textContent = plan ? `${plan.sourcePath ?? '(new note)'} → ${plan.notePath}` : matchingNotePath(this.adoption.externalRoot(), this.folder);
      changes.textContent = 'Waiting for checks.';
      if (plan) {
        changes.textContent = 'Create a note and bind it to this folder.';
        if (plan.sourcePath) {
          changes.textContent = plan.sourcePath === plan.notePath
            ? 'Bind the note and folder without moving either.'
            : 'Bind and move the note to match this folder.';
        }
      }
      warnings.textContent = plan?.warnings.join('\n') ?? '';
      acknowledgment.hidden = !plan?.descendants.length;
      descendants.textContent = plan?.descendants.join('\n') ?? '';
      technicalText.textContent = plan
        ? `UUID: ${plan.uuid}\nMarker: ${plan.folderPath}/${plan.uuid}.exnf\n${plan.aliases ? `Aliases after rename: ${plan.aliases.join(', ')}` : ''}`
        : 'Available after checks complete.';
    };
    hideSuggestions();
  }

  private async confirm(): Promise<void> {
    if (this.executing || this.recovery || !this.state.canConfirm || !this.state.preview) {
      return;
    }
    const { content, plan } = this.state.preview;
    this.executing = true;
    this.state.stop();
    this.refresh?.();
    const result = await this.adoption.executeForDialog(plan, content);
    this.executing = false;
    if (result.kind === 'complete') {
      this.close();
    } else {
      this.recovery = result.kind === 'pending' ? result.journal : undefined;
      this.state.fail(
        result.kind === 'pending' ? `${result.message}\nThis operation needs recovery. Resume folder adoption before trying again.` : result.message
      );
      if (!this.recovery) {
        // Retry is explicit after an execution failure, never an automatic mutation.
        this.state.activate();
      }
    }
  }

  private async inspect(): Promise<void> {
    const source = this.state.source;
    if (!source) {
      return;
    }
    this.inspecting = true;
    this.close();
    try {
      await this.adoption.openNote(source);
      const fragment = document.createDocumentFragment();
      const button = document.createElement('button');
      button.textContent = 'Return to folder adoption';
      fragment.append(button);
      const notice = new Notice(fragment, 0);
      this.adoption.trackNotice(notice);
      button.onclick = (): void => {
        notice.hide();
        this.inspecting = false;
        this.open();
      };
    } catch (error: unknown) {
      new Notice(String(error));
      this.inspecting = false;
      this.open();
    }
  }
}
