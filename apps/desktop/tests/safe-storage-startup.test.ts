import { describe, expect, it, vi } from 'vitest';
import { waitForMacosAsyncSafeStorageStartup } from '../src/main/safe-storage-startup.js';

describe('waitForMacosAsyncSafeStorageStartup', () => {
  it('gives packaged macOS 26+ arm64 keychain initialization time before the first async probe', async () => {
    const sleep = vi.fn(async () => undefined);

    await waitForMacosAsyncSafeStorageStartup({
      platform: 'darwin',
      arch: 'arm64',
      release: '25.6.0',
      isPackaged: true,
      sleep,
    });

    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it.each([
    { platform: 'darwin', arch: 'x64', release: '25.6.0', isPackaged: true },
    { platform: 'darwin', arch: 'arm64', release: '24.6.0', isPackaged: true },
    { platform: 'darwin', arch: 'arm64', release: '25.6.0', isPackaged: false },
    { platform: 'win32', arch: 'arm64', release: '10.0.26100', isPackaged: true },
    { platform: 'linux', arch: 'arm64', release: '6.8.0', isPackaged: true },
  ] as const)('does not delay unaffected startup %#', async (host) => {
    const sleep = vi.fn(async () => undefined);

    await waitForMacosAsyncSafeStorageStartup({ ...host, sleep });

    expect(sleep).not.toHaveBeenCalled();
  });
});
