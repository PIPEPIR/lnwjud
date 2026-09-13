export interface MacosSafeStorageStrategyOptions {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly release: string;
  readonly isPackaged: boolean;
}

/**
 * Electron's asynchronous macOS Keychain provider can wait indefinitely while
 * a packaged macOS 26 Apple Silicon app is starting. The synchronous API uses
 * the same OS-backed Keychain ciphertext without initializing that provider.
 */
export function shouldUseSynchronousMacosSafeStorage(
  options: MacosSafeStorageStrategyOptions,
): boolean {
  const darwinMajor = Number.parseInt(options.release.split('.')[0] ?? '', 10);
  return options.isPackaged
    && options.platform === 'darwin'
    && options.arch === 'arm64'
    && Number.isInteger(darwinMajor)
    && darwinMajor >= 25;
}
