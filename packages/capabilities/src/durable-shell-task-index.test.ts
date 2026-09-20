import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableShellTaskIndex } from './durable-shell-task-index.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0,
    retryDelay: 100,
  })));
});

describe('DurableShellTaskIndex', () => {
  it('bootstraps legacy terminal and active history once, then reinspects only active markers', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-index-bootstrap-'));
    temporaryRoots.push(root);
    await mkdir(path.join(root, 'history-terminal'));
    await mkdir(path.join(root, 'history-running'));
    await mkdir(path.join(root, 'history-unverified'));
    const firstInspector = vi.fn(async (taskId: string) => taskId === 'history-terminal' ? 'terminal' as const : 'active' as const);

    const first = new DurableShellTaskIndex(root, {
      maxConcurrentTasks: 3,
      inspectTask: firstInspector,
    });
    await first.initialize();

    expect(firstInspector.mock.calls.map(([taskId]) => taskId).sort()).toEqual([
      'history-running',
      'history-terminal',
      'history-unverified',
    ]);

    const warmInspector = vi.fn(async () => 'active' as const);
    const replacement = new DurableShellTaskIndex(root, {
      maxConcurrentTasks: 3,
      inspectTask: warmInspector,
    });
    await replacement.initialize();
    const reserved = await replacement.reserve({
      taskId: 'new-task',
      requestDigest: 'a'.repeat(64),
      ownerClientId: 'chatgpt',
      ownerWorkspaceId: 'workspace-a',
    });

    expect(reserved).toMatchObject({ ok: true, value: { activeTasks: 3 } });
    expect(warmInspector.mock.calls.map(([taskId]) => taskId).sort()).toEqual([
      'history-running',
      'history-unverified',
    ]);
    await replacement.release('new-task', 'a'.repeat(64));
  });

  it('serializes reservations across store instances so the active limit cannot be raced', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-index-limit-'));
    temporaryRoots.push(root);
    const inspectTask = vi.fn(async () => 'active' as const);
    const first = new DurableShellTaskIndex(root, { maxConcurrentTasks: 1, inspectTask });
    const second = new DurableShellTaskIndex(root, { maxConcurrentTasks: 1, inspectTask });
    await first.initialize();
    await second.initialize();

    const results = await Promise.all([
      first.reserve({
        taskId: 'task-one',
        requestDigest: '1'.repeat(64),
        ownerClientId: 'chatgpt',
        ownerWorkspaceId: 'workspace-a',
      }),
      second.reserve({
        taskId: 'task-two',
        requestDigest: '2'.repeat(64),
        ownerClientId: 'chatgpt',
        ownerWorkspaceId: 'workspace-a',
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'CONFLICT', recoverable: true }) }),
    ]);

    const successfulTaskId = results[0]?.ok ? 'task-one' : 'task-two';
    const successfulDigest = successfulTaskId === 'task-one' ? '1'.repeat(64) : '2'.repeat(64);
    await first.release(successfulTaskId, successfulDigest);
  });

  it('counts an unreadable active marker as active instead of freeing capacity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-index-unknown-'));
    temporaryRoots.push(root);
    const owner = {
      taskId: 'uncertain-task',
      requestDigest: 'a'.repeat(64),
      ownerClientId: 'chatgpt',
      ownerWorkspaceId: 'workspace-a',
    } as const;
    const first = new DurableShellTaskIndex(root, {
      maxConcurrentTasks: 1,
      inspectTask: async () => 'unknown',
    });
    await first.initialize();
    expect(await first.reserve(owner)).toMatchObject({ ok: true });
    const activeDirectory = path.join(root, '.index', 'v1', 'active');
    const [markerName] = await readdir(activeDirectory);
    expect(markerName).toBeDefined();
    await writeFile(path.join(activeDirectory, markerName!), '{not-json', 'utf8');

    const inspectTask = vi.fn(async () => 'terminal' as const);
    const replacement = new DurableShellTaskIndex(root, {
      maxConcurrentTasks: 1,
      inspectTask,
    });
    const blocked = await replacement.reserve({
      taskId: 'next-task',
      requestDigest: 'b'.repeat(64),
      ownerClientId: 'chatgpt',
      ownerWorkspaceId: 'workspace-a',
    });

    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', recoverable: true },
    });
    expect(inspectTask).not.toHaveBeenCalled();
    expect(await replacement.hasReservation(owner.taskId, owner.requestDigest)).toBe(false);
  });

  it('reclaims a missing pre-metadata reservation only after its launcher is proven gone', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-index-abandoned-'));
    temporaryRoots.push(root);
    const now = new Date('2026-09-20T10:00:00.000Z');
    const index = new DurableShellTaskIndex(root, {
      maxConcurrentTasks: 1,
      inspectTask: async () => 'missing',
      now: () => now,
    });
    await index.initialize();
    const abandonedTaskId = 'abandoned-before-metadata';
    const markerName = `${createHash('sha256').update(abandonedTaskId).digest('hex')}.json`;
    await writeFile(path.join(root, '.index', 'v1', 'active', markerName), JSON.stringify({
      version: 1,
      taskId: abandonedTaskId,
      requestDigest: 'a'.repeat(64),
      reservedAt: '2026-09-20T09:58:00.000Z',
      launcherPid: 2_147_483_647,
      launcherStartedAt: '2026-09-20T09:00:00.000Z',
    }), 'utf8');

    const reserved = await index.reserve({
      taskId: 'replacement-task',
      requestDigest: 'b'.repeat(64),
      ownerClientId: 'chatgpt',
      ownerWorkspaceId: 'workspace-a',
    });

    expect(reserved).toMatchObject({ ok: true, value: { activeTasks: 1, created: true } });
    await index.release('replacement-task', 'b'.repeat(64));
  });

  it('bootstraps and pages the compact launch journal without hydrating filtered histories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-index-journal-'));
    temporaryRoots.push(root);
    const records = new Map(Array.from({ length: 5 }, (_, offset) => {
      const ordinal = offset + 1;
      const taskId = `task-${ordinal}`;
      return [taskId, {
        version: 1 as const,
        taskId,
        startedAt: `2026-09-20T10:00:0${ordinal}.000Z`,
        ownerClientId: ordinal % 2 === 0 ? 'client-b' : 'client-a',
        ownerSessionId: ordinal % 2 === 0 ? 'session-b' : 'session-a',
        ownerWorkspaceId: 'workspace-a',
      }];
    }));
    await Promise.all([...records.keys()].map((taskId) => mkdir(path.join(root, taskId))));
    const loadLaunchRecord = vi.fn(async (taskId: string) => records.get(taskId));
    const index = new DurableShellTaskIndex(root, {
      maxConcurrentTasks: 2,
      inspectTask: async () => 'terminal',
      loadLaunchRecord,
    });
    await index.initialize();
    expect(loadLaunchRecord).toHaveBeenCalledTimes(5);
    loadLaunchRecord.mockClear();

    const first = await index.listLaunches({
      limit: 2,
      accept: (record) => record.ownerClientId === 'client-a',
    });
    expect(first).toMatchObject({
      ok: true,
      value: { records: [{ taskId: 'task-5' }, { taskId: 'task-3' }], nextCursor: expect.any(String) },
    });
    if (!first.ok || first.value.nextCursor === undefined) return;
    const second = await index.listLaunches({
      limit: 2,
      cursor: first.value.nextCursor,
      accept: (record) => record.ownerClientId === 'client-a',
    });
    expect(second).toMatchObject({ ok: true, value: { records: [{ taskId: 'task-1' }] } });
    expect(loadLaunchRecord).not.toHaveBeenCalled();

    await expect(index.listLaunches({ limit: 2, cursor: 'malformed' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('rebuilds a missing or corrupt launch journal under the index lock', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-index-journal-rebuild-'));
    temporaryRoots.push(root);
    await mkdir(path.join(root, 'task-a'));
    const record = {
      version: 1 as const,
      taskId: 'task-a',
      startedAt: '2026-09-20T10:00:00.000Z',
      ownerClientId: 'client-a',
      ownerSessionId: 'session-a',
      ownerWorkspaceId: 'workspace-a',
    };
    const index = new DurableShellTaskIndex(root, {
      maxConcurrentTasks: 1,
      inspectTask: async () => 'terminal',
      loadLaunchRecord: async () => record,
    });
    await index.initialize();
    const journalPath = path.join(root, '.index', 'v1', 'launches.jsonl');
    await rm(journalPath);
    await expect(index.listLaunches({ limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: { records: [{ taskId: 'task-a' }] },
    });

    await writeFile(journalPath, '{corrupt}\n', 'utf8');
    await expect(index.listLaunches({ limit: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', recoverable: true },
    });
    await expect(index.listLaunches({ limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: { records: [{ taskId: 'task-a' }] },
    });
  });
});
