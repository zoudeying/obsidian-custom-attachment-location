# AGENTS.md

## Advanced Rename and Delete Handler is a declared dependency, so every test vault carries it

`src/plugin.ts` declares Advanced Rename and Delete Handler through `getPluginDependencies()`. Until its API is published at contract `^1.1.0`, this plugin's `onloadImpl` does not run: no commands, no patches, no settings tab of its own — the library shows a blocked tab and a notice that install it in one click.

Consequences for anyone touching the tests:

- **Every integration vault seeds it.** `scripts/helpers/advanced-rename-and-delete-handler-seed.ts` downloads the pinned RELEASE (cached under `.cache/`) and writes it into the vault with a `data.json` that leaves renames, attachment-folder moves and deletions off, and sets the read-back values to this plugin's historic defaults (`DeleteWithEmptyParents` and so on). The desktop and Android projects get it from `scripts/vitest-global-setup.ts`, wired in `scripts/vitest-config.ts`; the demo-vault and performance projects compose it into their own setups. A new project that opens a vault needs the same, or every suite in it meets this plugin blocked.
- **No suite may disable or remove it.** It outlives each file, and taking it away closes this plugin's gate for every later file in the run. A suite that needs its settings changed proposes them through its `migrateSettings` API and hands the previous values back — see `src/attachment-unit-folder-rescue-cross-plugin.desktop.integration.test.ts`.
- **Unit tests publish a stand-in API.** `src/plugin.test.ts` publishes an empty API for the dependency in `beforeEach`; without it the gate never opens and nothing past the base loads. `unpublishProviderApi()` withdraws it, which is how the blocked path and the surface teardown are tested.
- **`onloadImpl` runs again each time the gate reopens.** Anything it stores outside its children has to be reset when the surface unloads — `attachmentCollector` is, because `collectAttachmentsInAbstractFiles` is public and would otherwise drive a torn-down collector.
