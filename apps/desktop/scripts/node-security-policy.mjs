export const MINIMUM_NODE_VERSION = '24.22.1';

export function assertSupportedNodeVersion(version) {
  const match = typeof version === 'string' ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version) : null;
  if (!match || Number(match[1]) !== 24
    || Number(match[2]) < 22 || Number(match[2]) === 22 && Number(match[3]) < 1) {
    throw new Error(`Node.js ${MINIMUM_NODE_VERSION} or later in the supported 24.x line is required; got ${version ?? 'unknown'}. Packaging remains blocked until Electron embeds a patched Node runtime.`);
  }
}
