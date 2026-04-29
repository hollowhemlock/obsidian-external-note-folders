# External Note Folders Smoke Test

Use this note for a quick manual pass in the sandbox vault.

## Setup

- Run `npm run fixtures:new-sandbox`.
- Run `npm run build`.
- Run `jiti scripts/install-plugin-to-sandbox.ts`.
- Open `test/fixtures/sandbox/vault` in Obsidian.
- Confirm the plugin setting points to `test/fixtures/sandbox/external-root`.

## Commands

- `Assign external folder identifier`: run on this note and confirm an `exf` value appears in frontmatter.
- `Open external folder`: run on this note and confirm the system file manager opens the matching external folder.
- `Verify external folders`: run after opening the folder and confirm this note appears as healthy or no integrity errors are reported.

## Quick Rename Check

- Rename this note in Obsidian.
- Run `Open external folder` again.
- Confirm the existing bound folder opens and no folder is deleted or auto-renamed.
