# External Note Folders

This is a plugin for [Obsidian](https://obsidian.md/) that Associate Obsidian vault notes with lazily created folders under an external root using UUIDs, preserving stable associations across moves and reorganizations.

## Installation

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/hollowhemlock/obsidian-external-note-folders).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command in the `DevTools Console`:

```js
window.DEBUG.enable('external-note-folders');
```

For more details, refer to the [documentation](https://github.com/mnaoumov/obsidian-dev-utils/blob/main/docs/debugging.md).

## Development Fixtures

- Fixture layout lives in `test/fixtures`.
- Run `npm run fixtures:new-sandbox` to create `sandbox/vault` and `sandbox/external-root`
  from committed fixture data.
- Run `npm run fixtures:refresh-sandbox` to refresh note/external-root content while preserving
  `sandbox/vault/.obsidian`.
- Run `npm run fixtures:open-fixture` or `npm run fixtures:open-sandbox` to open either test vault
  directly in Obsidian.
- Run `npm run vault:open -- <vault-path>` to open a specific vault path.
- `scripts/dev.ts` targets `test/fixtures/sandbox/vault/.obsidian` as the default dev vault.

Environment support for additional Obsidian config folders is available in `scripts/dev.ts`:

- `OBSIDIAN_CONFIG_FOLDER` for one extra `.obsidian` path
- `OBSIDIAN_CONFIG_FOLDERS` for a comma-separated list of extra `.obsidian` paths

Example values are in `.env.example`.

## License

© [Ryan](https://github.com/hollowhemlock/)
