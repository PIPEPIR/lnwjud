import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellCapabilityBackend } from './shell-backend.js';
import { DurableShellTaskStore, parsePosixProcessProbe } from './durable-shell-task-store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 5 : 0,
    retryDelay: 100,
  })));
});

describe('durable shell background tasks', () => {
  it('treats an exited POSIX zombie as terminated without trusting a reused live PID', () => {
    expect(parsePosixProcessProbe('Wed Sep  9 14:58:14 2026 Z+')).toEqual({ state: 'gone' });
    expect(parsePosixProcessProbe('Wed Sep  9 14:58:14 2026 Ssl')).toMatchObject({
      state: 'live',
      processStartedAt: expect.any(String),
    });
    expect(parsePosixProcessProbe('not-a-valid-ps-row')).toEqual({ state: 'unverifiable', reason: 'invalid_probe_response' });
  });

  it.skipIf(process.platform === 'win32')('cancels the detached child group before retiring its durable worker', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-groups-'));
    temporaryRoots.push(root);
    const backend = new ShellCapabilityBackend({ allowedRoots: [root], taskStateDirectory: path.join(root, '.tasks') });
    const started = await backend.execute({
      operation: 'run', executable: process.execPath, arguments: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd: root, execution: 'background', timeout_seconds: 40, userConfirmed: true,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const taskId = String((started.value as Record<string, unknown>).task_id);
    let childPid: number | undefined;
    let childStartedAt: string | undefined;
    try {
      await expect.poll(async () => {
        const status = await backend.execute({ operation: 'status', task_id: taskId });
        if (status.ok) {
          const value = status.value as Record<string, unknown>;
          if (typeof value.child_pid === 'number' && typeof value.child_started_at === 'string') {
            childPid = value.child_pid;
            childStartedAt = value.child_started_at;
            return true;
          }
        }
        return false;
      }, { timeout: 5000 }).toBe(true);
      const cancelled = await backend.execute({ operation: 'cancel', task_id: taskId, userConfirmed: true });
      expect(cancelled).toMatchObject({ ok: true, value: { state: 'cancelled' } });
      expect(() => process.kill(childPid!, 0)).toThrow();
    } finally {
      // Red-phase cleanup is restricted to the exact fixture child identity.
      if (childPid !== undefined && childStartedAt !== undefined) {
        const probe = await promisify(execFile)('ps', ['-p', String(childPid), '-o', 'lstart=']).catch(() => null);
        if (probe && new Date(probe.stdout.trim()).toISOString() === childStartedAt) process.kill(-childPid, 'SIGKILL');
      }
    }
  }, 15000);

  it('survives a backend/runtime replacement and returns logs and result by task id', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-shell-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const firstRuntime = new ShellCapabilityBackend({ allowedRoots: [root], taskStateDirectory });

    const started = await firstRuntime.execute({
      operation: 'run',
      executable: process.execPath,
      arguments: ['-e', "setTimeout(() => process.stdout.write('durable-done'), 300)"],
      cwd: root,
      execution: 'background',
      timeout_seconds: 30,
      userConfirmed: true,
    });

    expect(started).toMatchObject({ ok: true, value: { task_id: expect.any(String), durable: true } });
    if (!started.ok) return;
    const taskId = String((started.value as Record<string, unknown>).task_id);

    const replacementRuntime = new ShellCapabilityBackend({ allowedRoots: [root], taskStateDirectory });
    const waited = await replacementRuntime.execute({ operation: 'wait', task_id: taskId, timeout_seconds: 5 });
    expect(waited).toMatchObject({
      ok: true,
      value: { task_id: taskId, state: 'completed', exit_code: 0, stdout: 'durable-done', durable: true },
    });
    await expect(replacementRuntime.execute({ operation: 'list' })).resolves.toMatchObject({
      ok: true,
      value: { tasks: expect.arrayContaining([expect.objectContaining({ task_id: taskId, state: 'completed', durable: true })]) },
    });
  }, 15_000);

  it('does not overwrite a very fast durable completion back to running', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-shell-'));
    temporaryRoots.push(root);
    const backend = new ShellCapabilityBackend({
      allowedRoots: [root],
      taskStateDirectory: path.join(root, '.tasks'),
      autoWaitSeconds: 1,
    });

    const result = await backend.execute({
      operation: 'run',
      executable: process.execPath,
      arguments: ['-e', "process.stdout.write('fast')"],
      cwd: root,
      execution: 'auto',
      timeout_seconds: 30,
      userConfirmed: true,
    });

    expect(result).toMatchObject({ ok: true, value: { task_id: expect.any(String), durable: true } });
    if (!result.ok) return;
    const taskId = String((result.value as Record<string, unknown>).task_id);
    const terminal = (result.value as Record<string, unknown>).state === 'running'
      ? await backend.execute({ operation: 'wait', task_id: taskId, timeout_seconds: 5 })
      : result;
    expect(terminal).toMatchObject({ ok: true, value: { state: 'completed', exit_code: 0, stdout: 'fast', durable: true } });
    if (!terminal.ok) return;
    const workerPid = Number((terminal.value as Record<string, unknown>).worker_pid);
    expect(Number.isInteger(workerPid)).toBe(true);
    await expect.poll(() => {
      try {
        process.kill(workerPid, 0);
        return true;
      } catch {
        return false;
      }
    }, { timeout: 2000, interval: 50 }).toBe(false);

    await expect(backend.execute({ operation: 'status', task_id: taskId })).resolves.toMatchObject({
      ok: true,
      value: { state: 'completed', exit_code: 0, stdout: 'fast', durable: true },
    });
  }, 15_000);

  it('finalizes when the command exits even if a detached descendant keeps inherited stdio open', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-shell-'));
    temporaryRoots.push(root);
    const backend = new ShellCapabilityBackend({
      allowedRoots: [root],
      taskStateDirectory: path.join(root, '.tasks'),
    });
    const script = [
      "const { spawn } = require('node:child_process');",
      "const os = require('node:os');",
      "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {",
      "cwd: os.tmpdir(), detached: true, stdio: ['ignore', process.stdout, process.stderr] });",
      "grandchild.unref();",
      "process.stdout.write('parent-done');",
    ].join('');

    const started = await backend.execute({
      operation: 'run',
      executable: process.execPath,
      arguments: ['-e', script],
      cwd: root,
      execution: 'background',
      timeout_seconds: 30,
      userConfirmed: true,
    });
    expect(started).toMatchObject({ ok: true, value: { task_id: expect.any(String), durable: true } });
    if (!started.ok) return;
    const taskId = String((started.value as Record<string, unknown>).task_id);

    try {
      const terminal = await backend.execute({ operation: 'wait', task_id: taskId, timeout_seconds: 5 });
      expect(terminal).toMatchObject({
        ok: true,
        value: { state: 'completed', exit_code: 0, stdout: 'parent-done', durable: true },
      });
    } finally {
      const current = await backend.execute({ operation: 'status', task_id: taskId });
      if (current.ok && (current.value as Record<string, unknown>).state === 'running') {
        await backend.execute({ operation: 'wait', task_id: taskId, timeout_seconds: 5 });
      }
    }
  }, 20000);

  // Replacement cancellation probes worker identity and may invoke taskkill;
  // PowerShell startup can exceed Vitest's 5s default on a busy Windows host.
  it('cancels a durable task from a replacement backend', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-shell-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const firstRuntime = new ShellCapabilityBackend({ allowedRoots: [root], taskStateDirectory });
    const started = await firstRuntime.execute({
      operation: 'run',
      executable: process.execPath,
      arguments: ['-e', 'setTimeout(() => {}, 30000)'],
      cwd: root,
      execution: 'background',
      timeout_seconds: 60,
      userConfirmed: true,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const taskId = String((started.value as Record<string, unknown>).task_id);

    const replacementRuntime = new ShellCapabilityBackend({ allowedRoots: [root], taskStateDirectory });
    await waitUntil(async () => {
      const status = await replacementRuntime.execute({ operation: 'status', task_id: taskId });
      if (!status.ok) return false;
      const value = status.value as Record<string, unknown>;
      return typeof value.worker_pid === 'number'
        && typeof value.worker_started_at === 'string'
        && typeof value.child_pid === 'number'
        && typeof value.child_started_at === 'string';
    }, 15_000);
    const cancelled = await replacementRuntime.execute({ operation: 'cancel', task_id: taskId, userConfirmed: true });

    expect(cancelled).toMatchObject({ ok: true, value: { task_id: taskId, state: 'cancelled', durable: true } });
  }, 45_000);

  it('keeps a durable auto task running when the original MCP caller aborts after submission', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-shell-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const backend = new ShellCapabilityBackend({
      allowedRoots: [root],
      taskStateDirectory,
      autoWaitSeconds: 0.3,
      maxSynchronousWaitSeconds: 0.3,
    });
    const controller = new AbortController();
    const running = backend.execute({
      operation: 'run',
      executable: process.execPath,
      arguments: ['-e', "setTimeout(() => process.stdout.write('after-abort'), 600)"],
      cwd: root,
      execution: 'auto',
      timeout_seconds: 30,
      userConfirmed: true,
    }, controller.signal);
    setTimeout(() => controller.abort(), 100);

    const submitted = await running;
    expect(submitted).toMatchObject({ ok: true, value: { state: 'running', task_id: expect.any(String), durable: true } });
    if (!submitted.ok) return;
    const taskId = String((submitted.value as Record<string, unknown>).task_id);

    const replacementRuntime = new ShellCapabilityBackend({ allowedRoots: [root], taskStateDirectory });
    const finished = await replacementRuntime.execute({ operation: 'wait', task_id: taskId, timeout_seconds: 5 });
    expect(finished).toMatchObject({ ok: true, value: { state: 'completed', exit_code: 0, stdout: 'after-abort', durable: true } });
  });

  it('caps concurrent durable workers so many chats cannot exhaust a Windows 10/11 machine with child consoles', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-shell-cap-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const store = new DurableShellTaskStore(taskStateDirectory, { maxConcurrentTasks: 1 });
    const owner = { clientId: 'chatgpt', sessionId: 'session-a', workspaceId: 'workspace-a' };
    const common = {
      executable: process.execPath,
      arguments: ['-e', 'setTimeout(() => {}, 10000)'],
      cwd: root,
      timeoutSeconds: 30,
      maxOutputBytes: 1024,
      includeStdout: true,
      includeStderr: true,
      owner,
    } as const;

    const first = await store.launch({ taskId: 'task-one', ...common });
    expect(first).toMatchObject({ ok: true, value: { task_id: 'task-one', state: 'running' } });

    try {
      const second = await store.launch({ taskId: 'task-two', ...common });
      expect(second).toMatchObject({
        ok: false,
        error: {
          code: 'CONFLICT',
          recoverable: true,
        },
      });
    } finally {
      if (first.ok) await store.cancel('task-one', owner);
    }
  }, 15_000);
  it('does not hydrate historical durable output while enforcing the concurrency limit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-memory-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const historicalId = 'historical-completed';
    const historicalDirectory = path.join(taskStateDirectory, historicalId);
    await mkdir(historicalDirectory, { recursive: true });
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    await writeFile(path.join(historicalDirectory, 'task.json'), JSON.stringify({
      version: 1,
      task_id: historicalId,
      state: 'completed',
      started_at: startedAt,
      finished_at: new Date(Date.now() - 4_000).toISOString(),
      exit_code: 0,
      include_stdout: true,
      include_stderr: false,
      max_output_bytes: 1024,
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    }), 'utf8');
    const historicalOutputPath = path.join(historicalDirectory, 'stdout.log');
    await writeFile(historicalOutputPath, Buffer.alloc(2 * 1024 * 1024, 0x61));

    vi.mocked(readFile).mockClear();
    const store = new DurableShellTaskStore(taskStateDirectory);
    const owner = { clientId: 'chatgpt', sessionId: 'session-a', workspaceId: 'workspace-a' };
    const launched = await store.launch({
      taskId: 'new-task',
      executable: process.execPath,
      arguments: ['-e', "process.stdout.write('ok')"],
      cwd: root,
      timeoutSeconds: 30,
      maxOutputBytes: 1024,
      includeStdout: true,
      includeStderr: true,
      owner,
    });
    expect(launched.ok).toBe(true);

    const historicalOutputReads = vi.mocked(readFile).mock.calls.filter(
      ([filename]) => String(filename) === historicalOutputPath,
    );
    expect(historicalOutputReads).toEqual([]);

    if (launched.ok) await store.wait('new-task', 5, undefined, owner);
  }, 15_000);

  it('uses the persisted active index on warm launch without rescanning terminal task sidecars', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-warm-index-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const owner = { clientId: 'chatgpt', sessionId: 'session-a', workspaceId: 'workspace-a' };
    const request = {
      executable: process.execPath,
      arguments: ['-e', "process.stdout.write('ok')"],
      cwd: root,
      timeoutSeconds: 30,
      maxOutputBytes: 1024,
      includeStdout: true,
      includeStderr: true,
      owner,
    } as const;
    const terminalSidecars = new Set<string>();
    await Promise.all(Array.from({ length: 64 }, async (_, index) => {
      const taskId = `historical-${String(index).padStart(3, '0')}`;
      const taskDirectory = path.join(taskStateDirectory, taskId);
      await mkdir(taskDirectory, { recursive: true });
      const startedAt = new Date(Date.now() - 10_000 - index).toISOString();
      await writeFile(path.join(taskDirectory, 'task.json'), JSON.stringify({
        version: 1,
        task_id: taskId,
        state: 'completed',
        started_at: startedAt,
        finished_at: new Date(Date.now() - 5_000 - index).toISOString(),
        exit_code: 0,
        include_stdout: false,
        include_stderr: false,
        max_output_bytes: 1024,
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
      }), 'utf8');
      terminalSidecars.add(path.join(taskDirectory, 'task.json'));
      terminalSidecars.add(path.join(taskDirectory, 'worker.pid'));
      terminalSidecars.add(path.join(taskDirectory, 'worker.started'));
    }));

    const firstStore = new DurableShellTaskStore(taskStateDirectory);
    const first = await firstStore.launch({ taskId: 'first-terminal', ...request });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await expect(firstStore.wait('first-terminal', 5, undefined, owner)).resolves.toMatchObject({
      ok: true,
      value: { state: 'completed' },
    });

    const terminalDirectory = path.join(taskStateDirectory, 'first-terminal');
    terminalSidecars.add(path.join(terminalDirectory, 'task.json'));
    terminalSidecars.add(path.join(terminalDirectory, 'worker.pid'));
    terminalSidecars.add(path.join(terminalDirectory, 'worker.started'));
    vi.mocked(readFile).mockClear();

    const replacementStore = new DurableShellTaskStore(taskStateDirectory);
    const second = await replacementStore.launch({ taskId: 'second-running', ...request });
    expect(second.ok).toBe(true);
    const terminalReads = vi.mocked(readFile).mock.calls.filter(
      ([filename]) => terminalSidecars.has(String(filename)),
    );
    expect(terminalReads).toEqual([]);

    if (second.ok) await replacementStore.wait('second-running', 5, undefined, owner);
  }, 20_000);

  it('hydrates only one owner-scoped journal page instead of all durable histories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-page-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const ownerA = { clientId: 'chatgpt', sessionId: 'session-a', workspaceId: 'workspace-a' };
    await Promise.all(Array.from({ length: 20 }, async (_, offset) => {
      const ordinal = offset + 1;
      const taskId = `history-${String(ordinal).padStart(2, '0')}`;
      const taskDirectory = path.join(taskStateDirectory, taskId);
      await mkdir(taskDirectory, { recursive: true });
      await writeFile(path.join(taskDirectory, 'task.json'), JSON.stringify({
        version: 1,
        task_id: taskId,
        state: 'completed',
        started_at: `2026-09-20T10:00:${String(ordinal).padStart(2, '0')}.000Z`,
        finished_at: `2026-09-20T10:01:${String(ordinal).padStart(2, '0')}.000Z`,
        exit_code: 0,
        include_stdout: false,
        include_stderr: false,
        max_output_bytes: 1024,
        deadline_at: '2026-09-20T11:00:00.000Z',
        owner_client_id: ordinal % 2 === 0 ? 'other' : ownerA.clientId,
        owner_session_id: ordinal % 2 === 0 ? 'session-b' : ownerA.sessionId,
        owner_workspace_id: ownerA.workspaceId,
      }), 'utf8');
    }));
    const store = new DurableShellTaskStore(taskStateDirectory);
    const first = await store.listPage(ownerA, 3);
    expect(first).toMatchObject({
      ok: true,
      value: {
        tasks: [{ task_id: 'history-19' }, { task_id: 'history-17' }, { task_id: 'history-15' }],
        nextCursor: expect.any(String),
      },
    });
    if (!first.ok || first.value.nextCursor === undefined) return;

    vi.mocked(readFile).mockClear();
    const second = await store.listPage(ownerA, 3, first.value.nextCursor);
    expect(second).toMatchObject({
      ok: true,
      value: { tasks: [{ task_id: 'history-13' }, { task_id: 'history-11' }, { task_id: 'history-09' }] },
    });
    const metadataReads = vi.mocked(readFile).mock.calls.filter(
      ([filename]) => String(filename).endsWith(`${path.sep}task.json`),
    );
    expect(metadataReads).toHaveLength(3);
  });

  it('lists durable task metadata without hydrating historical output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-list-memory-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const taskId = 'listed-completed';
    const taskDirectory = path.join(taskStateDirectory, taskId);
    await mkdir(taskDirectory, { recursive: true });
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    await writeFile(path.join(taskDirectory, 'task.json'), JSON.stringify({
      version: 1,
      task_id: taskId,
      state: 'completed',
      started_at: startedAt,
      finished_at: new Date(Date.now() - 4_000).toISOString(),
      exit_code: 0,
      include_stdout: true,
      include_stderr: false,
      max_output_bytes: 1024,
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    }), 'utf8');
    const outputPath = path.join(taskDirectory, 'stdout.log');
    await writeFile(outputPath, Buffer.alloc(2 * 1024 * 1024, 0x63));

    vi.mocked(readFile).mockClear();
    const store = new DurableShellTaskStore(taskStateDirectory);
    const listed = await store.list();
    expect(listed).toEqual([expect.objectContaining({ task_id: taskId, state: 'completed', durable: true })]);
    expect(listed[0]).not.toHaveProperty('stdout');
    expect(listed[0]).not.toHaveProperty('stderr');
  });
  it('reads oversized legacy task output without whole-file readFile allocation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-durable-bounded-read-'));
    temporaryRoots.push(root);
    const taskStateDirectory = path.join(root, '.tasks');
    const taskId = 'legacy-oversized';
    const taskDirectory = path.join(taskStateDirectory, taskId);
    await mkdir(taskDirectory, { recursive: true });
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    await writeFile(path.join(taskDirectory, 'task.json'), JSON.stringify({
      version: 1,
      task_id: taskId,
      state: 'completed',
      started_at: startedAt,
      finished_at: new Date(Date.now() - 4_000).toISOString(),
      exit_code: 0,
      include_stdout: true,
      include_stderr: false,
      max_output_bytes: 1024,
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    }), 'utf8');
    const legacyOutputPath = path.join(taskDirectory, 'stdout.log');
    await writeFile(legacyOutputPath, Buffer.alloc(2 * 1024 * 1024, 0x62));

    vi.mocked(readFile).mockClear();
    const store = new DurableShellTaskStore(taskStateDirectory);
    const snapshot = await store.snapshot(taskId);
    expect(snapshot).toMatchObject({ ok: true, value: { stdout: 'b'.repeat(1024) } });
    const wholeFileReads = vi.mocked(readFile).mock.calls.filter(
      ([filename]) => String(filename) === legacyOutputPath,
    );
    expect(wholeFileReads).toEqual([]);
  });
});

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Condition was not met before timeout');
}
