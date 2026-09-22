/* global process */

import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = path.resolve(path.dirname(scriptPath), '..');

const BINDINGS_BY_TARGET = Object.freeze({
  'win32-x64': ['index.win32-x64-msvc.node'],
  'win32-arm64': ['index.win32-arm64-msvc.node'],
  'darwin-x64': ['index.darwin-universal.node'],
  'darwin-arm64': ['index.darwin-universal.node'],
  'linux-x64': ['index.linux-x64-gnu.node', 'index.linux-x64-musl.node'],
  'linux-arm64': ['index.linux-arm64-gnu.node', 'index.linux-arm64-musl.node'],
});

export function bindingsForTarget(platform, architecture) {
  const targetKey = `${platform}-${architecture}`;
  const bindingNames = BINDINGS_BY_TARGET[targetKey];
  if (bindingNames === undefined) throw new Error(`Unsupported main native-binding target: ${targetKey}`);
  return bindingNames;
}

export async function stageMainNativeBindings(options = {}) {
  const platform = options.platform ?? process.env.LNWJUD_RUNTIME_TARGET ?? process.platform;
  const architecture = options.architecture ?? process.env.LNWJUD_RUNTIME_ARCH ?? process.arch;
  const packageRoot = options.packageRoot ?? path.dirname(require.resolve('@electron-internal/extract-zip'));
  const destinationRoot = options.destinationRoot ?? path.join(desktopRoot, 'dist', 'main');
  const bindingNames = bindingsForTarget(platform, architecture);

  await mkdir(destinationRoot, { recursive: true });
  for (const entry of await readdir(destinationRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^index\..+\.node$/u.test(entry.name)) {
      await rm(path.join(destinationRoot, entry.name), { force: true });
    }
  }

  for (const bindingName of bindingNames) {
    const source = path.join(packageRoot, bindingName);
    const metadata = await stat(source).catch(() => undefined);
    if (!metadata?.isFile()) {
      throw new Error(`Required @electron-internal/extract-zip binding is missing: ${bindingName}`);
    }
    await copyFile(source, path.join(destinationRoot, bindingName));
  }

  process.stdout.write(`Staged main native bindings for ${platform}/${architecture}: ${bindingNames.join(', ')}\n`);
  return bindingNames;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await stageMainNativeBindings();
}
