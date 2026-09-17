import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const releaseNotesModuleUrl = pathToFileURL(path.join(repositoryRoot, 'scripts', 'release-notes.mjs')).href;

describe('standardized GitHub release notes', () => {
  it('classifies conventional entries into the three mandatory sections', async () => {
    const { normalizeReleaseNotesBody } = await import(releaseNotesModuleUrl);
    const sourceBody = `## What's Changed
* feat(action): add optional pr_number input and workflow_run fallback (#1156)
* fix(diff): flag untracked binary files as binary in workspace mode (#1288)
* perf(diff): skip oversized untracked files before reading (#1310)

**Full Changelog**: https://github.com/engasnm111/lnwjud/compare/v1.2.3...v1.2.4`;

    const body = normalizeReleaseNotesBody({
      sourceBody,
      repository: 'engasnm111/lnwjud',
      previousTag: 'v1.2.3',
      tag: 'v1.2.4',
    });

    expect(body).toContain('## Features\n\n- feat(action): add optional pr_number input and workflow_run fallback (#1156)');
    expect(body).toContain('## Bug Fixes\n\n- fix(diff): flag untracked binary files as binary in workspace mode (#1288)');
    expect(body).toContain('## Other Changes\n\n- perf(diff): skip oversized untracked files before reading (#1310)');
    expect(body).not.toContain("## What's Changed");
    expect(body).toContain('**Full Changelog**: https://github.com/engasnm111/lnwjud/compare/v1.2.3...v1.2.4');
  });

  it('preserves curated historical detail while mapping legacy headings', async () => {
    const { normalizeReleaseNotesBody } = await import(releaseNotesModuleUrl);
    const sourceBody = `## Highlights
- Added a new MCP capability.

## Reliability hardening
- Fixed a process-lifecycle race.

## Windows release assets
- \`lnwjud-Setup-4.8.3.exe\`

**Full Changelog**: https://github.com/engasnm111/lnwjud/compare/v4.7.1...v4.8.3`;

    const body = normalizeReleaseNotesBody({
      sourceBody,
      repository: 'engasnm111/lnwjud',
      previousTag: 'v4.7.1',
      tag: 'v4.8.3',
    });

    expect(body).toContain('## Features\n\n- Added a new MCP capability.');
    expect(body).toContain('## Bug Fixes\n\n- Fixed a process-lifecycle race.');
    expect(body).toContain('## Other Changes\n\n- `lnwjud-Setup-4.8.3.exe`');
  });

  it('keeps empty categories visible and collapses duplicate changelog lines', async () => {
    const { normalizeReleaseNotesBody } = await import(releaseNotesModuleUrl);
    const sourceBody = `## Other Changes
- **Full Changelog:** https://github.com/engasnm111/lnwjud/compare/v1.0.1...v1.1.1

**Full Changelog**: https://github.com/engasnm111/lnwjud/compare/v1.0.1...v1.1.1`;
    const fallbackBody = `## What's Changed
* docs: clarify setup instructions (#2)

**Full Changelog**: https://github.com/engasnm111/lnwjud/compare/v1.0.1...v1.1.1`;

    const body = normalizeReleaseNotesBody({
      sourceBody,
      fallbackBody,
      repository: 'engasnm111/lnwjud',
      previousTag: 'v1.0.1',
      tag: 'v1.1.1',
    });

    expect(body).toContain('## Features\n\n- None.');
    expect(body).toContain('## Bug Fixes\n\n- None.');
    expect(body).toContain('## Other Changes\n\n- docs: clarify setup instructions (#2)');
    expect(body.match(/\*\*Full Changelog\*\*/g)).toHaveLength(1);
  });
});
