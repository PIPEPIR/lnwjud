import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import { promisify } from 'node:util';
import { assertSupportedNodeVersion } from '../../apps/desktop/scripts/node-security-policy.mjs';
import { verifyPackagedNodeSecurity } from '../../apps/desktop/scripts/verify-packaged-node-security.mjs';
import rejectPrepackagedArtifact from '../../apps/desktop/scripts/reject-prepackaged-artifact.mjs';

for (const version of ['24.21.0', '24.22.0', '22.16.0', '25.0.0', '24.22.1-rc.1', '', undefined, null, ['24.22.1'], 24]) {
  test(`rejects unsupported or unpatched Node ${version}`, () => {
    assert.throws(() => assertSupportedNodeVersion(version), /24\.22\.1.*required/);
  });
}
for (const version of ['24.22.1', '24.22.2', '24.23.0']) {
  test(`accepts patched supported Node ${version}`, () => assert.doesNotThrow(() => assertSupportedNodeVersion(version)));
}

for (const [platform, relative] of Object.entries({
  win32: 'lnwjud.exe', darwin: 'lnwjud.app/Contents/MacOS/lnwjud', linux: 'lnwjud',
})) {
  test(`checks the actual ${platform} packaged host instead of the build Node`, async () => {
    const context = { appOutDir: path.resolve('test-output'), electronPlatformName: platform };
    const run = async (executable, args, options) => {
      assert.equal(executable, path.join(context.appOutDir, relative));
      assert.deepEqual(args, ['-p', 'JSON.stringify(process.versions)']);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
      assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(options.env.NODE_PATH, undefined);
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 15_000);
      return { stdout: JSON.stringify({ electron: '45.0.0-alpha.7', node: '24.21.0' }) };
    };
    await assert.rejects(verifyPackagedNodeSecurity(context, run), /Packaging remains blocked/);
    const versions = await verifyPackagedNodeSecurity(context, async () => ({
      stdout: JSON.stringify({ electron: '45.0.1', node: '24.22.1' }),
    }));
    assert.equal(versions.node, '24.22.1');
  });
}

test('fails closed for unverifiable targets and malformed runtime output', async () => {
  const context = { appOutDir: path.resolve('test-output'), electronPlatformName: process.platform };
  await assert.rejects(verifyPackagedNodeSecurity(context, async () => { throw new Error('ENOEXEC'); }), /Cannot verify/);
  for (const stdout of ['not json', '{}', '{"node":"24.22.1"}', '{"electron":"45.0.1"}']) {
    await assert.rejects(verifyPackagedNodeSecurity(context, async () => ({ stdout })));
  }
  await assert.rejects(verifyPackagedNodeSecurity({ ...context, electronPlatformName: 'unknown' }), /supported packaged/);
});

test('rejects a real standalone build Node even when its Node version is patched', async () => {
  const run = promisify(execFile);
  const context = { appOutDir: path.resolve('test-output'), electronPlatformName: process.platform };
  await assert.rejects(verifyPackagedNodeSecurity(context, (_executable, args, options) => (
    run(process.execPath, args, options)
  )), /did not identify itself as Electron/);
});

test('all electron-builder package targets run the security gate before evidence capture', async () => {
  const config = await readFile(new URL('../../apps/desktop/electron-builder.yml', import.meta.url), 'utf8');
  assert.match(config, /^afterPack: scripts\/verify-packaged-node-security\.mjs$/m);
  assert.match(config, /^artifactBuildCompleted: scripts\/reject-prepackaged-artifact\.mjs$/m);
  const hook = await readFile(new URL('../../apps/desktop/scripts/verify-packaged-node-security.mjs', import.meta.url), 'utf8');
  assert.ok(hook.indexOf('await verifyPackagedNodeSecurity(context)') < hook.indexOf('await capturePackagedRuntimeEvidence(context)'));
});

test('rejects every prepackaged artifact while permitting normal packaging options', () => {
  for (const prepackaged of [path.resolve('old-app'), '', false]) {
    assert.throws(() => rejectPrepackagedArtifact({ packager: { packagerOptions: { prepackaged } } }), /Prepackaged artifacts are unsupported/);
  }
  for (const prepackaged of [null, undefined]) {
    assert.doesNotThrow(() => rejectPrepackagedArtifact({ packager: { packagerOptions: { prepackaged } } }));
  }
  assert.throws(() => rejectPrepackagedArtifact({}), /Cannot verify artifact packaging options/);
});

test('pinned builder prepackaged bypass cannot reach its artifact publication event', async () => {
  const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'));
  const { Packager } = builderRequire('app-builder-lib/out/packager');
  const { PlatformPackager } = builderRequire('app-builder-lib/out/platformPackager');
  const packager = Object.create(PlatformPackager.prototype);
  // Exercise the pinned builder's real early return, getter, and event ordering.
  packager.info = { options: { prepackaged: path.resolve('unverified-old-app') } };
  await PlatformPackager.prototype.doPack.call(packager, {});
  let published = false;
  const artifactOwner = {
    eventEmitter: { emit: async (name, event) => {
      assert.equal(name, 'artifactBuildCompleted');
      rejectPrepackagedArtifact(event);
    } },
    emitArtifactCreated: async () => { published = true; },
  };
  await assert.rejects(Packager.prototype.emitArtifactBuildCompleted.call(artifactOwner, {
    file: path.resolve('unverified-installer.exe'), packager, target: null, arch: 1,
  }), /Prepackaged artifacts are unsupported/);
  assert.equal(published, false);
});

test('build engines, local pin, and every Node CI job require the patched release', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.node, '>=24.22.1 <25');
  assert.equal((await readFile(new URL('../../.node-version', import.meta.url), 'utf8')).trim(), '24.22.1');
  for (const name of ['ci', 'dev-installer', 'downstream-update', 'release', 'runtime-dependency-update']) {
    const workflow = await readFile(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    const versions = [...workflow.matchAll(/node-version: '([^']+)'/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, `No Node setup found in ${name}`);
    assert.ok(versions.every((version) => version === '24.22.1'), `Unpatched Node setup in ${name}`);
  }
});
