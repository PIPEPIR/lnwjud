const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function resolveReleaseSourceIdentity(actualCommit, env = process.env) {
  const actual = normalizeRequiredSha(actualCommit, 'checked-out commit');
  const explicitExpected = normalizeOptionalSha(env.LNWJUD_EXPECTED_COMMIT_SHA, 'LNWJUD_EXPECTED_COMMIT_SHA');
  const workflowTrigger = normalizeOptionalSha(env.GITHUB_SHA, 'GITHUB_SHA');
  const expected = explicitExpected ?? workflowTrigger;

  if (expected && expected.toLowerCase() !== actual.toLowerCase()) {
    const source = explicitExpected ? 'LNWJUD_EXPECTED_COMMIT_SHA' : 'GITHUB_SHA';
    throw new Error(`${source} does not match checked-out commit: expected=${expected} git=${actual}`);
  }

  return {
    commit: actual,
    expectedCommit: expected,
    expectationSource: explicitExpected ? 'LNWJUD_EXPECTED_COMMIT_SHA' : workflowTrigger ? 'GITHUB_SHA' : null,
    workflowTriggerCommit: workflowTrigger,
  };
}

function normalizeRequiredSha(value, label) {
  const normalized = String(value ?? '').trim();
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} is not a full 40-character Git SHA: ${normalized || '<empty>'}`);
  return normalized;
}

function normalizeOptionalSha(value, label) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} is not a full 40-character Git SHA: ${normalized}`);
  return normalized;
}
