import { describe, expect, it } from 'vitest';
import { shouldUseSynchronousMacosSafeStorage } from '../src/main/safe-storage-startup.js';

describe('shouldUseSynchronousMacosSafeStorage', () => {
  it('avoids Electron async keychain initialization on packaged macOS 26+ arm64', () => {
    expect(shouldUseSynchronousMacosSafeStorage({
      platform: 'darwin',
      arch: 'arm64',
      release: '25.6.0',
      isPackaged: true,
    })).toBe(true);
  });

  it.each([
    { platform: 'darwin', arch: 'x64', release: '25.6.0', isPackaged: true },
    { platform: 'darwin', arch: 'arm64', release: '24.6.0', isPackaged: true },
    { platform: 'darwin', arch: 'arm64', release: '25.6.0', isPackaged: false },
    { platform: 'win32', arch: 'arm64', release: '10.0.26100', isPackaged: true },
    { platform: 'linux', arch: 'arm64', release: '6.8.0', isPackaged: true },
  ] as const)('keeps async safeStorage on unaffected startup %#', (host) => {
    expect(shouldUseSynchronousMacosSafeStorage(host)).toBe(false);
  });
});
