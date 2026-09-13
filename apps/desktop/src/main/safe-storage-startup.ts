const MACOS_ASYNC_SAFE_STORAGE_SETTLE_MS = 2_000;

export interface MacosAsyncSafeStorageStartupOptions {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly release: string;
  readonly isPackaged: boolean;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * macOS 26 on Apple Silicon can leave Electron's lazily initialized async
 * Keychain provider pending when it is probed immediately after app.ready.
 * Electron issue #51759 documents the same startup race and the two-second
 * initialization window. Keep the workaround scoped to affected packages.
 */
export async function waitForMacosAsyncSafeStorageStartup(
  options: MacosAsyncSafeStorageStartupOptions,
): Promise<void> {
  const darwinMajor = Number.parseInt(options.release.split('.')[0] ?? '', 10);
  const affected = options.isPackaged
    && options.platform === 'darwin'
    && options.arch === 'arm64'
    && Number.isInteger(darwinMajor)
    && darwinMajor >= 25;
  if (!affected) return;

  const sleep = options.sleep ?? ((milliseconds: number): Promise<void> => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  await sleep(MACOS_ASYNC_SAFE_STORAGE_SETTLE_MS);
}
