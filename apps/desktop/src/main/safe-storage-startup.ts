export interface MacosSafeStorageStrategyOptions {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly release: string;
  readonly isPackaged: boolean;
}

/**
 * Electron's async macOS encryptor can wait indefinitely for its lazily
 * initialized Keychain provider on packaged macOS 26 Apple Silicon hosts.
 * The synchronous safeStorage API uses the same compatible ciphertext without
 * starting that provider. Keep the compatibility path scoped to affected apps.
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
