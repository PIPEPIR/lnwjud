# Maintaining the in-app What's New registry

The Desktop title bar has two independent controls:

1. the existing version/update button, which keeps update/check/install behavior;
2. the adjacent `?` button, which opens bundled release notes for the exact installed version.

Do not merge those responsibilities.

## Source files

- `apps/desktop/src/renderer/features/release-notes/release-notes.ts` — typed local release-note registry.
- `apps/desktop/src/renderer/features/release-notes/WhatsNewModal.tsx` — accessible modal.
- `apps/desktop/src/renderer/i18n/messages.ts` — Thai/English titles, descriptions, badges, empty-state and accessibility copy.
- `apps/desktop/tests/release-notes.test.ts` — exact-version and missing-version behavior.

## Adding a release

Before packaging a new public version:

1. Add exactly one registry entry whose `version` equals the installed semantic version.
2. Keep stable item/category IDs; put user-visible copy in i18n rather than branching on locale in components.
3. Describe only functionality that actually ships. Provider contracts that remain unavailable must not be described as ready.
4. Keep the registry local/offline. Opening What's New must not require GitHub or any network request.
5. Run the release-note tests and the normal release/version gates.

`scripts/set-version.mjs` synchronizes version surfaces but intentionally does **not** invent release notes. The release-note entry is a reviewed product artifact.

## Current v5.5.2 release-note coverage

The bundled `5.5.2` entry must describe the continuation fix that actually ships in this patch:

- `read_file_page_continue`, `workspace_context_continue`, and `workspace_full_scan_continue` consume tokens across consecutive modern HTTP requests, including OpenAI Secure MCP Tunnel;
- only bounded continuation stores are shared across per-request server recreation; request-scoped `McpServer`/`ToolRegistry` teardown remains intact;
- continuation tokens remain one-shot, use the existing bounded 10-minute TTL, and are keyed by session identity so another session cannot consume the owner's token;
- regression coverage exercises the real modern HTTP boundary instead of only reusing one engine/registry instance.

The historical `5.5.1` registry entry remains bundled for exact-version display on older installations.

Keep README/FULL_README release notes and Thai/English in-app copy semantically aligned with this registry. Do not add claims for fixes that are not in the packaged artifact.

## Accessibility contract

The `?` trigger must remain a real focusable button. The modal must:

- use `role="dialog"` and `aria-modal="true"`;
- move focus into the dialog when opened;
- trap Tab/Shift+Tab inside the dialog;
- close on Escape;
- restore focus to the previous trigger on close;
- keep long release notes scrollable;
- show a localized graceful empty state when the exact installed version has no registry entry.

## Localization

Use the existing translator and message keys. Do not introduce `isTh`, `locale === 'th'`, or component-local Thai/English branches for release-note content.

The required tooltip is:

- Thai: `ดูกันว่ามีอะไรอัพเดตใหม่`
- English: `See what’s new`
