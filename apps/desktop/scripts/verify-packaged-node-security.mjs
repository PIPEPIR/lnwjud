import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import capturePackagedRuntimeEvidence from './capture-packaged-runtime-evidence.mjs';
import { assertSupportedNodeVersion } from './node-security-policy.mjs';

const execute = promisify(execFile);
const executablePaths = Object.freeze({
  win32: ['lnwjud.exe'],
  darwin: ['lnwjud.app', 'Contents', 'MacOS', 'lnwjud'],
  linux: ['lnwjud'],
});

export async function verifyPackagedNodeSecurity(context, run = execute) {
  const parts = executablePaths[context?.electronPlatformName];
  if (!parts || typeof context?.appOutDir !== 'string' || !path.isAbsolute(context.appOutDir)) {
    throw new Error('A supported packaged Electron target and absolute output directory are required');
  }
  const executable = path.join(context.appOutDir, ...parts);
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  let stdout;
  try {
    ({ stdout } = await run(executable, ['-p', 'JSON.stringify(process.versions)'], {
      env, timeout: 15_000, maxBuffer: 16_384, windowsHide: true, shell: false,
    }));
  } catch (error) {
    throw new Error(`Cannot verify the packaged Electron Node runtime: ${executable}. Build on a host that can execute the target binary.`, { cause: error });
  }
  let versions;
  try {
    versions = JSON.parse(stdout.trim());
  } catch {
    throw new Error('Packaged Electron did not report valid runtime versions');
  }
  if (typeof versions?.electron !== 'string' || versions.electron.length === 0) {
    throw new Error('Packaged runtime did not identify itself as Electron');
  }
  assertSupportedNodeVersion(versions.node);
  return versions;
}

export default async function verifyAndCapturePackagedRuntime(context) {
  await verifyPackagedNodeSecurity(context);
  await capturePackagedRuntimeEvidence(context);
}
