/* global console, process, setTimeout */

import { spawn } from 'node:child_process';

const target = process.argv[2];
if (target !== 'macos' && target !== 'linux') throw new Error('Usage: node scripts/package-native.mjs <macos|linux>');
if ((target === 'macos' && process.platform !== 'darwin') || (target === 'linux' && process.platform !== 'linux')) {
  throw new Error(`The ${target} package must be built on its target operating system`);
}

const architecture = process.env.LNWJUD_RUNTIME_ARCH ?? process.arch;
if (architecture !== 'x64' && architecture !== 'arm64') throw new Error(`Unsupported ${target} architecture: ${architecture}`);
const environment = {
  ...process.env,
  LNWJUD_RUNTIME_TARGET: target === 'macos' ? 'darwin' : 'linux',
  LNWJUD_RUNTIME_ARCH: architecture,
};
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const electronBuilderArgs = [target === 'macos' ? '--mac' : '--linux', ...(target === 'macos' ? ['dmg', 'zip'] : ['AppImage', 'deb']), `--${architecture}`, '--publish', 'never'];

await run('node', ['scripts/prepare-runtime-tools.mjs'], environment);
await run('node', ['scripts/prepare-ecc-runtime.mjs'], environment);
await run('node', [target === 'macos' ? 'scripts/build-macos-host.mjs' : 'scripts/build-linux-host.mjs'], environment);
await run(corepack, ['pnpm@10.15.0', '--filter', '@lnwjud/desktop...', 'build'], environment);
await runElectronBuilderWithRetry(electronBuilderArgs, environment);
await run('node', ['scripts/write-release-evidence.mjs'], environment);
await run('node', ['scripts/verify-release-evidence.mjs'], environment);

async function runElectronBuilderWithRetry(args, env) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await run('electron-builder', args, env, true);
      return;
    } catch (error) {
      if (attempt === 3 || !isTransientDownloadFailure(error)) throw error;
      const delayMs = 1_000 * 2 ** (attempt - 1);
      console.warn(`electron-builder download failed transiently; retrying in ${delayMs}ms (attempt ${attempt + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isTransientDownloadFailure(error) {
  const details = `${error?.message ?? ''}\n${error?.output ?? ''}`;
  return /connection reset by peer|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|socket hang up|TLS handshake timeout|temporary failure in name resolution/i.test(details);
}

function run(command, args, env, captureOutput = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: false,
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let output = '';
    if (captureOutput) {
      const forward = (stream, destination) => stream?.on('data', (chunk) => {
        destination.write(chunk);
        output = (output + chunk.toString()).slice(-65_536);
      });
      forward(child.stdout, process.stdout);
      forward(child.stderr, process.stderr);
    }
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${command} ${args.join(' ')} exited with ${code ?? 'unknown'}`);
      if (captureOutput) error.output = output;
      reject(error);
    });
  });
}
