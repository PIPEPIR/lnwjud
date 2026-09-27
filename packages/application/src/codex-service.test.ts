import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok, type Result } from '@lnwjud/domain';
import { permissionProfiles } from '@lnwjud/permissions';
import type { ManagedProcess, ProcessLogResult } from '@lnwjud/process';
import type { Workspace, WorkspaceRepository } from '@lnwjud/workspace';
import type { CodexStatus } from '@lnwjud/codex';
import { CodexService, MAX_CODEX_HOST_LOG_BYTES, type CodexAdapterPort } from './codex-service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CodexService', () => {
  it('requires EXECUTE permission before starting a Codex task and audits only metadata', async () => {
    const workspace = await createWorkspace();
    const adapter = fakeAdapter();
    const audit = { calls: [] as string[], async recordCodexRun(input: { codexTaskId: string; instruction: string }): Promise<void> { this.calls.push(`${input.codexTaskId}:${input.instruction}`); } };
    const service = new CodexService(repository(workspace), { adapter, auditService: audit, profile: permissionProfiles.balanced, taskIdFactory: (): string => 'codex-task-1' });

    const result = await service.run({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'review this workspace', undefined, true);

    expect(result).toMatchObject({ ok: true, value: { codexTaskId: 'codex-task-1', processId: 'process-1' } });
    expect(adapter.starts).toEqual([{ cwd: workspace.realRootPath, instruction: 'review this workspace' }]);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toContain('codex-task-1:review this workspace');
  });

  it('returns PERMISSION_REQUIRED under Safe without starting or auditing a task', async () => {
    const workspace = await createWorkspace();
    const adapter = fakeAdapter();
    const audit = { calls: 0, async recordCodexRun(): Promise<void> { this.calls += 1; } };
    const result = await new CodexService(repository(workspace), { adapter, auditService: audit, profile: permissionProfiles.safe })
      .run({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'review this workspace');

    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    expect(adapter.starts).toHaveLength(0);
    expect(audit.calls).toBe(0);
  });

  it('accepts trusted Full Bypass authorization without rewriting caller confirmation', async () => {
    const workspace = await createWorkspace();
    const adapter = fakeAdapter();
    const service = new CodexService(repository(workspace), { adapter, profile: permissionProfiles.safe });
    const authorization = { mode: 'full_bypass', applicationApproved: true, bypassApplicationAuthorization: true, source: 'full_bypass' } as const;

    await expect(service.run(
      { clientId: 'client-1', clientName: 'test' },
      workspace.id,
      'review this workspace',
      undefined,
      false,
      authorization,
    )).resolves.toMatchObject({ ok: true, value: { processId: 'process-1' } });
    expect(adapter.starts).toEqual([{ cwd: workspace.realRootPath, instruction: 'review this workspace' }]);
  });

  it('reads the current permission profile for later Codex tasks', async () => {
    const workspace = await createWorkspace();
    const adapter = fakeAdapter();
    let profile = permissionProfiles.safe;
    const service = new CodexService(repository(workspace), {
      adapter,
      profileProvider: (): typeof profile => profile,
    });

    await expect(service.run({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'blocked first'))
      .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    profile = permissionProfiles.balanced;
    await expect(service.run({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'allowed second', undefined, true))
      .resolves.toMatchObject({ ok: true, value: { processId: 'process-1' } });
  });

  it('exposes bounded task status/logs and cancellation only to the owning client', async () => {
    const workspace = await createWorkspace();
    const adapter = fakeAdapter();
    const service = new CodexService(repository(workspace), { adapter, taskIdFactory: (): string => 'codex-task-1' });
    const started = await service.run({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'review this workspace', undefined, true);
    if (!started.ok) throw new Error('Codex task did not start');

    await expect(service.taskStatus({ clientId: 'client-1', clientName: 'test' }, workspace.id, started.value.codexTaskId))
      .resolves.toMatchObject({ ok: true, value: { processId: 'process-1' } });
    await expect(service.taskLogs({ clientId: 'client-1', clientName: 'test' }, workspace.id, started.value.codexTaskId, { tailLines: 20 }))
      .resolves.toMatchObject({ ok: true, value: { entries: [] } });
    await expect(service.stop({ clientId: 'client-2', clientName: 'other' }, workspace.id, started.value.codexTaskId))
      .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    await expect(service.stop({ clientId: 'client-1', clientName: 'test' }, workspace.id, started.value.codexTaskId, true))
      .resolves.toMatchObject({ ok: true });
  });

  it('stops a Codex process with verified retry when cancellation races its launch response', async () => {
    const workspace = await createWorkspace();
    const controller = new AbortController();
    const stopCalls: Array<{ processId: string; autoRetry: boolean | undefined }> = [];
    const adapter = fakeAdapter();
    adapter.start = async (cwd, instruction): Promise<Result<ManagedProcess>> => {
      controller.abort();
      return ok({ processId: 'process-race', executable: 'codex', args: ['exec', instruction], cwd, state: 'running', startedAt: new Date(0).toISOString() });
    };
    adapter.stop = async (processId, autoRetry): Promise<Result<void>> => {
      stopCalls.push({ processId, autoRetry });
      return ok(undefined);
    };
    const service = new CodexService(repository(workspace), { adapter });

    await expect(service.run({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'review', controller.signal, true))
      .resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_TIMEOUT' } });
    expect(stopCalls).toEqual([{ processId: 'process-race', autoRetry: true }]);
  });

  it('lists and authorizes a provisionally created Codex task before start settles', async () => {
    const workspace = await createWorkspace();
    const handle: ManagedProcess = {
      processId: 'process-provisional',
      executable: 'codex',
      args: ['exec', 'review'],
      cwd: workspace.realRootPath,
      state: 'termination_unverified',
      startedAt: new Date(0).toISOString(),
      error: 'Process termination could not be verified',
    };
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    let created!: () => void;
    const createdGate = new Promise<void>((resolve) => { created = resolve; });
    let stops = 0;
    const adapter = fakeAdapter();
    adapter.start = async (_cwd, _instruction, _signal, onCreated): Promise<Result<ManagedProcess>> => {
      onCreated?.(handle);
      created();
      await startGate;
      return ok(handle);
    };
    adapter.statusProcess = (): Result<ManagedProcess> => ok(handle);
    adapter.stop = async (): Promise<Result<void>> => { stops += 1; return ok(undefined); };
    const service = new CodexService(repository(workspace), { adapter, taskIdFactory: (): string => 'codex-provisional' });
    const actor = { clientId: 'client-1', clientName: 'test' };

    const starting = service.run(actor, workspace.id, 'review', undefined, true);
    await createdGate;
    await expect(service.list(actor, workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ codexTaskId: 'codex-provisional', process: { processId: 'process-provisional', state: 'termination_unverified' } }],
    });
    await expect(service.stop(actor, workspace.id, 'codex-provisional', true)).resolves.toMatchObject({ ok: true });
    expect(stops).toBe(1);
    releaseStart();
    await expect(starting).resolves.toMatchObject({ ok: true, value: { codexTaskId: 'codex-provisional' } });
  });

  it('isolates Codex task handles between sessions of the same client and workspace', async () => {
    const workspace = await createWorkspace();
    const service = new CodexService(repository(workspace), { adapter: fakeAdapter(), taskIdFactory: (): string => 'codex-session-task' });
    const owner = { clientId: 'client-1', clientName: 'test', sessionId: 'session-a' };
    const otherSession = { clientId: 'client-1', clientName: 'test', sessionId: 'session-b' };
    const started = await service.run(owner, workspace.id, 'review', undefined, true);
    if (!started.ok) throw new Error('Codex task did not start');

    await expect(service.taskStatus(otherSession, workspace.id, started.value.codexTaskId)).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    await expect(service.list(otherSession, workspace.id)).resolves.toMatchObject({ ok: true, value: [] });
    await expect(service.taskStatus(owner, workspace.id, started.value.codexTaskId)).resolves.toMatchObject({ ok: true });
    expect(service.statusForGoalLiveness(workspace.id, started.value.codexTaskId)).toMatchObject({ ok: true, value: { state: 'running' } });
    expect(service.statusForGoalLiveness('another-workspace', started.value.codexTaskId)).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });

  it('lists host task metadata across MCP sessions and reads bounded logs by known task id', async () => {
    const workspace = await createWorkspace();
    const queries: unknown[] = [];
    const stoppedProcessIds: string[] = [];
    const adapter = fakeAdapter();
    adapter.logs = (_processId, query): Result<ProcessLogResult> => {
      queries.push(query);
      return ok({ entries: [{ sequence: 1, stream: 'stdout', text: 'safe output' }], truncated: false, nextSequence: 2 });
    };
    adapter.stop = async (processId): Promise<Result<void>> => { stoppedProcessIds.push(processId); return ok(undefined); };
    let nextTaskId = 0;
    const service = new CodexService(repository(workspace), {
      adapter,
      taskIdFactory: (): string => `host-task-${++nextTaskId}`,
    });
    const firstActor = { clientId: 'client-1', clientName: 'test', sessionId: 'session-a' };
    const secondActor = { clientId: 'client-1', clientName: 'test', sessionId: 'session-b' };
    await service.run(firstActor, workspace.id, 'private prompt A', undefined, true);
    await service.run(secondActor, workspace.id, 'private prompt B', undefined, true);

    const hostTasks = service.hostTaskList();
    expect(hostTasks).toMatchObject({
      ok: true,
      value: [
        { codexTaskId: 'host-task-1', workspaceId: workspace.id, state: 'running' },
        { codexTaskId: 'host-task-2', workspaceId: workspace.id, state: 'running' },
      ],
    });
    expect(JSON.stringify(hostTasks)).not.toContain('private prompt');
    adapter.statusProcess = (): Result<ManagedProcess> => ok({
      processId: 'process-1', executable: 'codex', args: ['[REDACTED]'], cwd: workspace.realRootPath,
      state: 'failed', startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(),
      exitCode: 1, error: 'private prompt API_TOKEN=secret-value',
    });
    const failedHostTasks = service.hostTaskList();
    expect(failedHostTasks).toMatchObject({ ok: true, value: [{ state: 'failed', exitCode: 1 }, { state: 'failed', exitCode: 1 }] });
    expect(JSON.stringify(failedHostTasks)).not.toContain('private prompt');
    expect(JSON.stringify(failedHostTasks)).not.toContain('secret-value');
    adapter.statusProcess = fakeAdapter().statusProcess;
    await expect(service.list(firstActor, workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ codexTaskId: 'host-task-1' }],
    });
    await expect(service.taskStatus(secondActor, workspace.id, 'host-task-1'))
      .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(service.hostTaskLogs('host-task-1', { tailLines: 20 })).toMatchObject({
      ok: true,
      value: { entries: [{ text: 'safe output' }] },
    });
    expect(queries).toEqual([{ tailLines: 20 }]);
    expect(service.hostTaskLogs('missing-task', { tailLines: 20 }))
      .toMatchObject({ ok: false, error: { code: 'PROCESS_NOT_FOUND' } });
    expect(service.hostTaskLogs('host-task-1', { tailLines: 201 }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    adapter.logs = (): Result<ProcessLogResult> => ok({
      entries: [{ sequence: 1, stream: 'stdout', text: 'x'.repeat(MAX_CODEX_HOST_LOG_BYTES + 100) }],
      truncated: false,
      nextSequence: 2,
    });
    const boundedLogs = service.hostTaskLogs('host-task-1', { tailLines: 20 });
    expect(boundedLogs.ok).toBe(true);
    if (boundedLogs.ok) {
      expect(Buffer.byteLength(boundedLogs.value.entries.map((entry) => entry.text).join(''))).toBeLessThanOrEqual(MAX_CODEX_HOST_LOG_BYTES);
      expect(boundedLogs.value.truncated).toBe(true);
    }
    await expect(service.hostStopTask('host-task-1')).resolves.toMatchObject({ ok: true });
    expect(stoppedProcessIds).toEqual(['process-1']);
    await expect(service.hostStopTask('unknown-task')).resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_NOT_FOUND' } });
  });

  it('fires the optional host terminal callback only once and contains callback failures', async () => {
    const workspace = await createWorkspace();
    const terminalListeners: Array<(process: ManagedProcess) => void> = [];
    const adapter = fakeAdapter();
    adapter.start = async (cwd, _instruction, _signal, _onCreated, _sandboxMode, onTerminal): Promise<Result<ManagedProcess>> => {
      if (onTerminal !== undefined) terminalListeners.push(onTerminal);
      return ok({ processId: 'process-1', executable: 'codex', args: ['exec'], cwd, state: 'running', startedAt: new Date(0).toISOString() });
    };
    const events: unknown[] = [];
    const service = new CodexService(repository(workspace), {
      adapter,
      taskIdFactory: (): string => 'terminal-task',
      diagnostic: (): void => {},
      onTaskTerminal: (event): void => { events.push(event); throw new Error('notification failed'); },
    });

    await expect(service.run({ clientId: 'client-1', clientName: 'test' }, workspace.id, 'private prompt', undefined, true))
      .resolves.toMatchObject({ ok: true });
    const terminal = {
      processId: 'process-1', executable: 'codex', args: [], cwd: workspace.realRootPath,
      state: 'exited', startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), exitCode: 0,
    } satisfies ManagedProcess;
    terminalListeners[0]?.(terminal);
    terminalListeners[0]?.(terminal);

    expect(events).toEqual([{
      codexTaskId: 'terminal-task', workspaceId: workspace.id, state: 'exited',
      startedAt: terminal.startedAt, finishedAt: terminal.finishedAt, exitCode: 0,
    }]);
  });

  it('cancels a tracked Codex task across MCP sessions while enforcing stable client/workspace ownership', async () => {
    const workspace = await createWorkspace();
    let current: ManagedProcess = {
      processId: 'process-1', executable: 'codex', args: [], cwd: workspace.realRootPath,
      state: 'running', startedAt: new Date(0).toISOString(),
    };
    const stopCalls: Array<{ processId: string; autoRetry: boolean | undefined }> = [];
    const adapter = fakeAdapter();
    adapter.statusProcess = (): Result<ManagedProcess> => ok(current);
    adapter.stop = async (processId, autoRetry): Promise<Result<void>> => {
      stopCalls.push({ processId, autoRetry });
      current = { ...current, state: 'stopped', finishedAt: new Date(1).toISOString(), exitCode: -1 };
      return ok(undefined);
    };
    const service = new CodexService(repository(workspace), { adapter, taskIdFactory: (): string => 'codex-goal-cancel' });
    const started = await service.run(
      { clientId: 'client-1', clientName: 'test', sessionId: 'session-a' },
      workspace.id,
      'review',
      undefined,
      true,
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await expect(service.cancelForGoal('client-2', workspace.id, started.value.codexTaskId))
      .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    await expect(service.cancelForGoal('client-1', workspace.id, started.value.codexTaskId))
      .resolves.toMatchObject({ ok: true, value: { matched: true, state: 'cancelled' } });
    expect(stopCalls).toEqual([{ processId: 'process-1', autoRetry: true }]);
    await expect(service.cancelForGoal('client-1', workspace.id, started.value.codexTaskId))
      .resolves.toMatchObject({ ok: true, value: { matched: true, state: 'already_terminal' } });
  });
});

async function createWorkspace(): Promise<Workspace> {
  const rawRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-codex-service-'));
  roots.push(rawRoot);
  const root = await realpath(rawRoot);
  await mkdir(path.join(root, 'src'));
  return { id: 'workspace-1', displayName: 'Fixture', rootPath: root, realRootPath: root, createdAt: new Date(0).toISOString() };
}

function repository(workspace: Workspace): WorkspaceRepository {
  return { async list(): Promise<Workspace[]> { return [workspace]; }, async get(id: string): Promise<Workspace | null> { return id === workspace.id ? workspace : null; }, async insert(): Promise<void> {}, async delete(): Promise<void> {} };
}

function fakeAdapter(): CodexAdapterPort & { starts: { cwd: string; instruction: string }[] } {
  const starts: { cwd: string; instruction: string }[] = [];
  return {
    starts,
    async status(): Promise<Result<CodexStatus>> { return ok({ installed: true, executablePath: 'C:\\tools\\codex.exe', version: '0.42.1', capabilities: ['exec'] }); },
    async start(cwd, instruction): Promise<Result<ManagedProcess>> { starts.push({ cwd, instruction }); return ok({ processId: 'process-1', executable: 'codex', args: ['exec', instruction], cwd, state: 'running', startedAt: new Date(0).toISOString() }); },
    statusProcess(): Result<ManagedProcess> { return ok({ processId: 'process-1', executable: 'codex', args: [], cwd: 'C:\\workspace', state: 'running', startedAt: new Date(0).toISOString() }); },
    logs(): Result<ProcessLogResult> { return ok({ entries: [], truncated: false, nextSequence: 0 }); },
    async stop(): Promise<Result<void>> { return ok(undefined); },
  };
}
