import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReleaseSourceIdentity } from './release-source-commit.mjs';

const TRIGGER = '1111111111111111111111111111111111111111';
const REBASED = '2222222222222222222222222222222222222222';

test('uses GITHUB_SHA as the default source expectation', () => {
  const identity = resolveReleaseSourceIdentity(TRIGGER, { GITHUB_SHA: TRIGGER });
  assert.equal(identity.commit, TRIGGER);
  assert.equal(identity.expectedCommit, TRIGGER);
  assert.equal(identity.expectationSource, 'GITHUB_SHA');
  assert.equal(identity.workflowTriggerCommit, TRIGGER);
});

test('allows a post-rebase source SHA while preserving the workflow trigger SHA', () => {
  const identity = resolveReleaseSourceIdentity(REBASED, {
    GITHUB_SHA: TRIGGER,
    LNWJUD_EXPECTED_COMMIT_SHA: REBASED,
  });
  assert.equal(identity.commit, REBASED);
  assert.equal(identity.expectedCommit, REBASED);
  assert.equal(identity.expectationSource, 'LNWJUD_EXPECTED_COMMIT_SHA');
  assert.equal(identity.workflowTriggerCommit, TRIGGER);
});

test('still rejects a mismatched explicit source SHA', () => {
  assert.throws(
    () => resolveReleaseSourceIdentity(REBASED, {
      GITHUB_SHA: TRIGGER,
      LNWJUD_EXPECTED_COMMIT_SHA: '3333333333333333333333333333333333333333',
    }),
    /LNWJUD_EXPECTED_COMMIT_SHA does not match checked-out commit/,
  );
});

test('rejects malformed provenance SHAs', () => {
  assert.throws(
    () => resolveReleaseSourceIdentity(REBASED, { LNWJUD_EXPECTED_COMMIT_SHA: 'not-a-sha' }),
    /not a full 40-character Git SHA/,
  );
});
