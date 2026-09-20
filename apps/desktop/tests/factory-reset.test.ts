import { access, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPendingFactoryResetSync, factoryResetMarkerPath, stageFactoryResetSync } from '../src/main/factory-reset.js';

describe('factory reset staging', () => {
  it('removes persisted lnwjud data and the separate Tunnel profile before recreating an empty data root', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-factory-reset-'));
    const dataPath = path.join(parent, 'lnwjud-data');
    const tunnelPath = path.join(parent, 'tunnel-client');
    await mkdir(path.join(dataPath, 'Local Storage', 'leveldb'), { recursive: true });
    await mkdir(path.join(dataPath, 'backups'), { recursive: true });
    await mkdir(tunnelPath, { recursive: true });
    await writeFile(path.join(dataPath, 'lnwjud.sqlite'), 'database');
    await writeFile(path.join(dataPath, 'checkpoint-master.key'), 'secret');
    await writeFile(path.join(dataPath, 'Local Storage', 'leveldb', '000001.log'), 'renderer-state');
    await writeFile(path.join(dataPath, 'backups', 'snapshot.db'), 'backup');
    await writeFile(path.join(tunnelPath, 'lnwjud.secret'), 'tunnel-secret');
    await writeFile(path.join(tunnelPath, 'lnwjud.yaml'), 'profile');

    const marker = stageFactoryResetSync(dataPath);
    expect(marker).toBe(factoryResetMarkerPath(dataPath));
    await expect(access(marker)).resolves.toBeUndefined();

    expect(applyPendingFactoryResetSync(dataPath, tunnelPath)).toBe(true);
    await expect(readdir(dataPath)).resolves.toEqual([]);
    await expect(access(tunnelPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(applyPendingFactoryResetSync(dataPath, tunnelPath)).toBe(false);
  });

  it('refuses to stage a reset for the filesystem root', () => {
    expect(() => stageFactoryResetSync(path.parse(process.cwd()).root)).toThrow(/filesystem root/);
  });
});
