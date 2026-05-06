# External Note Folders Smoke Test

Use this note for a quick manual pass in the sandbox vault.

## Setup

- Run `npm run integration:prepare`.
- Run `npm run fixtures:open-sandbox`.
- Confirm the plugin setting is prefilled with the full path variant of `test/fixtures/sandbox/external-root`.

## Commands

- `Assign external folder identifier`: run on this note and confirm an `exnf` value appears in frontmatter.
- `Open external folder`: run on this note and confirm the system file manager opens the matching external folder.
- `Report external folder drift`: run after opening the folder and confirm this note reports no integrity errors or unexpected path.
- `Reconcile external folders`: run after opening the folder and confirm the dry-run plan shows no move needed for this note.

## Quick Rename Check

- Rename this note in Obsidian.
- Run `Open external folder` again.
- Confirm the existing bound folder opens and no folder is deleted or auto-renamed.
