import { describe, expect, it } from 'vitest';
import { releaseNotesForVersion } from '../src/renderer/features/release-notes/release-notes.js';

describe('release notes registry', () => {
  it('resolves the exact installed version only', () => {
    expect(releaseNotesForVersion('5.5.3')).toMatchObject({ version: '5.5.3' });
    expect(releaseNotesForVersion(' 5.5.3 ')).toMatchObject({ version: '5.5.3' });
    expect(releaseNotesForVersion('5.5.2')).toMatchObject({ version: '5.5.2' });
    expect(releaseNotesForVersion('5.5.1')).toMatchObject({ version: '5.5.1' });
    expect(releaseNotesForVersion('5.5.0')).toMatchObject({ version: '5.5.0' });
    expect(releaseNotesForVersion('5.5.1-beta.1')).toBeUndefined();
    expect(releaseNotesForVersion('5.4.3')).toBeUndefined();
  });

  it('keeps release-note categories non-empty so the modal can hide empty groups deterministically', () => {
    const note = releaseNotesForVersion('5.5.3');
    expect(note).toBeDefined();
    expect(note?.categories.length).toBeGreaterThan(0);
    for (const category of note?.categories ?? []) {
      expect(category.items.length).toBeGreaterThan(0);
    }
  });
});
