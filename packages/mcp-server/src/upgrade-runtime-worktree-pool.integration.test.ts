import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitService } from '../../application/src/git-service.js';
import type { Workspace, WorkspaceRepository } from '@lnwjud/workspace';
import { UpgradeRuntimeService } from './upgrade-runtime.js';

const execFileAsync = promisify(execFile);

function repository(workspace: Workspace): WorkspaceRepository {
  return {
    async list(): Promise<Workspace[]> { return [workspace]; },
    async get(id: string): Promise<Workspace | null> { return id === workspace.id ? workspace : null; },
    async insert(): Promise<void> {},
    async delete(): Promise<void> {},
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true });
  return result.stdout.trim();
}

describe('upgrade runtime reusable worktree pool with real Git', () => {
  it('reuses the same clean worktree at a new base while preserving ignored cache data', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-worktree-pool-real-'));
    try {
      await git(root, 'init');
      await git(root, 'config', 'user.email', 'pool-test@example.invalid');
      await git(root, 'config', 'user.name', 'Pool Test');
      await writeFile(path.join(root, '.gitignore'), '.worktrees/\ncache/\n', 'utf8');
      await writeFile(path.join(root, 'base.txt'), 'base-one\n', 'utf8');
      await git(root, 'add', '.gitignore', 'base.txt');
      await git(root, 'commit', '-m', 'base one');
      const firstBase = await git(root, 'rev-parse', 'HEAD');

      const canonicalRoot = await realpath(root);
      const workspace: Workspace = {
        id: 'workspace-real-pool',
        displayName: 'Real pool fixture',
        rootPath: canonicalRoot,
        realRootPath: canonicalRoot,
        createdAt: new Date(0).toISOString(),
      };
      const service = new GitService(repository(workspace));
      const actor = { clientId: 'pool-real-client', clientName: 'test', sessionId: 'session-a' };
      const authorization = {
        mode: 'full_bypass',
        applicationApproved: true,
        bypassApplicationAuthorization: true,
        source: 'full_bypass',
      } as const;
      const runtime = new UpgradeRuntimeService({
        platform: process.platform,
        git: service,
      }, actor);

      const created = await runtime.execute('git_worktree_spawn', {
        workspaceId: workspace.id,
        worktreePath: '.worktrees/pool-real',
        ref: firstBase,
        dryRun: false,
        userConfirmed: true,
      }, undefined, authorization);
      expect(created).toMatchObject({ ok: true, value: { reused: false, worktreeLeaseGeneration: 1 } });
      if (!created.ok) throw new Error('worktree create failed');
      const createdValue = created.value as {
        worktreePath: string;
        worktreeLeaseToken: string;
        worktreeLeaseGeneration: number;
      };
      const worktreeRoot = path.join(root, '.worktrees', 'pool-real');
      await mkdir(path.join(worktreeRoot, 'cache'), { recursive: true });
      await writeFile(path.join(worktreeRoot, 'cache', 'warm.txt'), 'warm-cache\n', 'utf8');

      const pooled = await runtime.execute('git_worktree_remove', {
        workspaceId: workspace.id,
        worktreePath: createdValue.worktreePath,
        retainIdle: true,
        evidenceCaptured: true,
        dependencyFingerprint: 'lock-v1',
        worktreeLeaseToken: createdValue.worktreeLeaseToken,
        worktreeLeaseGeneration: createdValue.worktreeLeaseGeneration,
        maxIdle: 2,
        dryRun: false,
        userConfirmed: true,
      }, undefined, authorization);
      expect(pooled).toMatchObject({ ok: true, value: { pooled: true, dependencyFingerprint: 'lock-v1' } });

      await writeFile(path.join(root, 'base.txt'), 'base-two\n', 'utf8');
      await git(root, 'add', 'base.txt');
      await git(root, 'commit', '-m', 'base two');
      const secondBase = await git(root, 'rev-parse', 'HEAD');

      const reused = await runtime.execute('git_worktree_spawn', {
        workspaceId: workspace.id,
        worktreePath: '.worktrees/fallback',
        ref: secondBase,
        reuseIdle: true,
        dependencyFingerprint: 'lock-v1',
        dryRun: false,
        userConfirmed: true,
      }, undefined, authorization);
      expect(reused).toMatchObject({
        ok: true,
        value: {
          reused: true,
          worktreePath: createdValue.worktreePath,
          dependenciesReusable: true,
          worktreeLeaseGeneration: 2,
        },
      });
      expect(await readFile(path.join(worktreeRoot, 'base.txt'), 'utf8')).toBe('base-two\n');
      expect(await readFile(path.join(worktreeRoot, 'cache', 'warm.txt'), 'utf8')).toBe('warm-cache\n');
      expect(await git(worktreeRoot, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
