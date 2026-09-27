import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@lnwjud/domain';
import type { FileActor } from '@lnwjud/application';
import { UpgradeRuntimeService } from './upgrade-runtime.js';
import { UPGRADE_TOOL_CATALOG } from './upgrade-catalog.js';
import { ToolRegistry } from './tool-registry.js';
import type { McpApplicationServices } from './tools/tool-types.js';

const actor: FileActor = { clientId: 'test', clientName: 'test' };
const fullBypassAuthorization = {
  mode: 'full_bypass',
  applicationApproved: true,
  bypassApplicationAuthorization: true,
  source: 'full_bypass',
} as const;

describe('upgrade runtime', () => {
  it('has deterministic coverage for the roadmap tool catalog', () => {
    expect(UPGRADE_TOOL_CATALOG.length).toBeGreaterThan(100);
    expect(new Set(UPGRADE_TOOL_CATALOG.map((entry) => entry.name)).size).toBe(UPGRADE_TOOL_CATALOG.length);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'dev_context')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'handoff_context')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'context_economy_stats')).toBe(true);
  });

  // Keep this catalog/registry smoke deterministic: verify operational tools
  // cross the normal input-validation boundary, while dependency-gated optional
  // tools stay undisclosed until their provider is configured. Focused tests cover
  // the actual host/provider execution paths without coupling this smoke to CI load.
  it('keeps every phase tool on the deterministic registry boundary', async () => {
    const registry = new ToolRegistry({}, actor);
    const registeredNames = new Set(registry.list().map((tool) => tool.name));
    for (const entry of UPGRADE_TOOL_CATALOG) {
      const response = await registry.invoke(entry.name, { __registrySmokeUnexpected: true });
      expect(response.isError).toBe(true);
      if (registeredNames.has(entry.name)) {
        expect(response.structuredContent).toMatchObject({
          error: { code: 'INVALID_INPUT', message: 'Tool input is invalid' },
        });
      } else {
        expect(entry.availability).toBe('optional');
        expect(response.structuredContent).toMatchObject({
          error: { code: 'INVALID_INPUT', message: 'Unknown MCP tool' },
        });
      }
    }
  });

  it('publishes strict upgrade schemas and rejects silently ignored arguments', async () => {
    const registry = new ToolRegistry({}, actor);
    const invalid = await registry.invoke('live_logs_query', { level: 'error' });
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toMatchObject({ error: { code: 'INVALID_INPUT' } });

    const valid = await registry.invoke('live_logs_query', { toolName: 'shell', phase: 'completed', limit: 10 });
    expect(valid.structuredContent).toBeDefined();

    const runtime = new UpgradeRuntimeService({}, actor);
    const described = await runtime.execute('tool_describe', { name: 'live_logs_query' });
    expect(described).toMatchObject({ ok: true, value: {
      found: true,
      contractSource: 'upgrade-tool-contracts',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object' },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execution: { taskSupport: 'forbidden' },
    } });
  });

  it('routes prompts and searches capabilities without an LLM', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const route = await runtime.execute('route_intent', { prompt: 'Live Logs MCP activity ไม่ขึ้น' });
    expect(route).toMatchObject({ ok: true, value: { route: 'debug', domain: 'desktop/mcp/logging' } });
    const substringRoute = await runtime.execute('route_intent', { prompt: 'build the project package' });
    expect(substringRoute).toMatchObject({ ok: true, value: { route: 'workspace', reasonCodes: ['fallback:workspace'] } });
    const search = await runtime.execute('tool_search', { query: 'postgres schema inspection' });
    expect(search.ok).toBe(true);
    if (search.ok) expect(search.value).toHaveProperty('matches');
  });

  it('ranks primitive and upgrade tools with deterministic reasons without granting authorization', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const search = await runtime.execute('tool_dynamic_filter', { query: 'run a Linux WSL developer command', limit: 20, reranker: 'local' });

    expect(search).toMatchObject({ ok: true, value: {
      selectedModel: 'deterministic',
      reranker: {
        requested: 'local',
        disposition: 'unavailable',
        localExecutionPerformed: false,
        deterministicFallbackApplied: true,
      },
      fallbackReason: 'local_model_not_configured',
      primitiveToolsRemainAvailable: true,
      authorizationUnchanged: true,
      rankedCandidates: expect.arrayContaining([
        expect.objectContaining({
          name: 'wsl_exec',
          permission: 'EXECUTE',
          reasonCodes: expect.any(Array),
          rankingSignals: expect.objectContaining({
            readiness: 'operational',
            telemetrySamples: 0,
            successRate: null,
            p95LatencyMs: null,
          }),
        }),
      ]),
    } });
    if (search.ok) expect(search.value.rankedCandidates[0]?.name).toBe('wsl_exec');
  });

  it('exposes bounded readiness, risk, and schema-fit ranking signals without changing authorization', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const search = await runtime.execute('tool_dynamic_filter', {
      query: 'database sql params query',
      limit: 30,
    });

    expect(search).toMatchObject({ ok: true, value: { authorizationUnchanged: true, rankedCandidates: expect.any(Array) } });
    if (search.ok) {
      const dbQuery = search.value.rankedCandidates.find((candidate) => candidate.name === 'db_query');
      expect(dbQuery).toMatchObject({
        permission: 'READ',
        rankingSignals: {
          readiness: 'dependency_gated',
          schemaMatchedFields: expect.arrayContaining(['database', 'sql', 'params']),
          telemetrySamples: 0,
          successRate: null,
          p95LatencyMs: null,
        },
      });
      expect(dbQuery?.reasonCodes).toEqual(expect.arrayContaining([
        'readiness:dependency-gated',
        'schema-field:database',
        'schema-field:sql',
        'schema-field:params',
      ]));
    }
  });

  it('excludes user-disabled tools from dynamic discovery, ranking, describe, and category counts', async () => {
    const baseline = new UpgradeRuntimeService({}, actor);
    const beforeCategories = await baseline.execute('tool_categories', {});
    const runtime = new UpgradeRuntimeService({}, actor, undefined, (name) => name !== 'read_file');
    const search = await runtime.execute('tool_search', { query: 'read file', limit: 100 });
    const dynamic = await runtime.execute('tool_dynamic_filter', { query: 'read file', limit: 100 });
    const described = await runtime.execute('tool_describe', { name: 'read_file' });
    const afterCategories = await runtime.execute('tool_categories', {});

    expect(search).toMatchObject({ ok: true, value: { matches: expect.any(Array), rankedCandidates: expect.any(Array) } });
    expect(dynamic).toMatchObject({ ok: true, value: { matches: expect.any(Array), rankedCandidates: expect.any(Array) } });
    if (search.ok) {
      expect(search.value.matches.map((entry) => entry.name)).not.toContain('read_file');
      expect(search.value.rankedCandidates.map((entry) => entry.name)).not.toContain('read_file');
    }
    if (dynamic.ok) {
      expect(dynamic.value.matches.map((entry) => entry.name)).not.toContain('read_file');
      expect(dynamic.value.rankedCandidates.map((entry) => entry.name)).not.toContain('read_file');
    }
    expect(described).toEqual({ ok: true, value: { found: false, name: 'read_file' } });
    if (beforeCategories.ok && afterCategories.ok) {
      expect(afterCategories.value.categories).toEqual(beforeCategories.value.categories);
    }
  });

  it('ranks guarded exact file editing ahead of shell for source repairs', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const search = await runtime.execute('tool_function_find', {
      prompt: 'replace exact text in a TypeScript source file without a shell script',
      limit: 10,
    });

    expect(search).toMatchObject({ ok: true, value: { rankedCandidates: expect.any(Array) } });
    if (search.ok) {
      const names = search.value.rankedCandidates.map((candidate) => candidate.name);
      expect(names[0]).toBe('edit_file');
      const shellIndex = names.indexOf('shell');
      if (shellIndex >= 0) expect(names.indexOf('edit_file')).toBeLessThan(shellIndex);
    }
  });

  it('advertises guarded file editing as the preferred alternative to shell rewriting', () => {
    const registry = new ToolRegistry({}, actor);
    const byName = new Map(registry.list().map((tool) => [tool.name, tool.description]));
    expect(byName.get('edit_file')).toContain('First choice');
    expect(byName.get('edit_file')).toContain('instead of shell');
    expect(byName.get('shell')).toContain('Never use shell as a source/config/text editor');
    expect(byName.get('shell')).toContain('call edit_file first');
    expect(byName.get('shell')).toContain('rejected before native approval');
  });

  it('returns route reason codes and a measurable deterministic model selection', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const route = await runtime.execute('route_intent', { prompt: 'debug the WSL task timeout and inspect live logs' });

    expect(route).toMatchObject({ ok: true, value: {
      route: 'debug',
      selectedModel: 'deterministic',
      reasonCodes: expect.arrayContaining(['keyword:debug', 'keyword:wsl']),
      authorizationUnchanged: true,
    } });
  });

  it('keeps context reads unrestricted while asking for dangerous actions', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const read = await runtime.execute('permission_check', { action: 'filesystem.read' });
    const remove = await runtime.execute('permission_check', { action: 'filesystem.delete' });
    expect(read).toMatchObject({ ok: true, value: { decision: 'allow', contextAccess: 'unrestricted' } });
    expect(remove).toMatchObject({ ok: true, value: { decision: 'ask', contextAccess: 'unrestricted' } });
  });

  it('keeps hooks create-only and makes plugin mutations persistent when runtime state is configured', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);

    await expect(runtime.execute('hook_register', { name: 'audit', event: 'beforeTool' }))
      .resolves.toMatchObject({ ok: true, value: { registered: true } });
    await expect(runtime.execute('hook_register', { name: 'audit', event: 'afterTool' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    await expect(runtime.execute('plugin_list', {})).resolves.toMatchObject({
      ok: true,
      value: { tool: 'plugin_list', status: 'ready', available: true, ready: true, executed: true, plugins: [], persistence: 'memory_only' },
    });
    for (const [name, input] of [
      ['plugin_install', { name: 'safe-plugin' }],
      ['plugin_enable', { name: 'safe-plugin' }],
      ['plugin_disable', { name: 'safe-plugin' }],
      ['plugin_remove', { name: 'safe-plugin', userConfirmed: true }],
    ] as const) {
      await expect(runtime.execute(name, input)).resolves.toMatchObject({
        ok: true,
        value: { tool: name, status: 'needs_setup', available: false, ready: false, executed: false, requirements: ['persistent runtime state path'] },
      });
    }

    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-plugin-registry-'));
    try {
      const persistent = new UpgradeRuntimeService({ runtimeStatePath: path.join(directory, 'runtime.json') }, actor);
      await expect(persistent.execute('plugin_install', { name: 'safe-plugin', source: 'local-test-registry', version: '1.2.3' })).resolves.toMatchObject({
        ok: true, value: {
          tool: 'plugin_install', status: 'ready', executed: true, name: 'safe-plugin', enabled: true,
          source: 'local-test-registry', version: '1.2.3', trustTier: 'external', namespace: 'plugin:safe-plugin',
          persistence: 'shared_locked_state',
        },
      });
      await expect(persistent.execute('plugin_list', {})).resolves.toMatchObject({
        ok: true, value: {
          status: 'ready',
          plugins: [{ name: 'safe-plugin', enabled: true, source: 'local-test-registry', version: '1.2.3', trustTier: 'external', namespace: 'plugin:safe-plugin' }],
          persistence: 'shared_locked_state',
        },
      });
      await expect(persistent.execute('plugin_disable', { name: 'safe-plugin' })).resolves.toMatchObject({
        ok: true, value: { status: 'ready', executed: true, enabled: false, previousEnabled: true },
      });
      await expect(persistent.execute('plugin_enable', { name: 'safe-plugin' })).resolves.toMatchObject({
        ok: true, value: { status: 'ready', executed: true, enabled: true, previousEnabled: false },
      });
      await expect(persistent.execute('plugin_remove', { name: 'safe-plugin', userConfirmed: true })).resolves.toMatchObject({
        ok: true, value: { status: 'ready', executed: true, removed: true },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('shares context economy telemetry between workspace context and the stats tool', async () => {
    const registry = new ToolRegistry({
      workspaceInfo: { async list(): Promise<ReturnType<typeof ok>> { return ok([{ id: 'workspace-1' }]); } },
      search: {
        async searchText(): Promise<ReturnType<typeof ok>> { return ok({ matches: [{ path: 'src/app.ts', line: 1, text: 'login' }], truncated: false }); },
        async searchFiles(): Promise<ReturnType<typeof ok>> { return ok({ paths: ['src/app.ts'], truncated: false }); },
      },
      file: { async readFile(): Promise<ReturnType<typeof ok>> { return ok({ path: 'src/app.ts', content: 'export function login() {}\n', startLine: 1, endLine: 1, encoding: 'utf8' as const, byteLength: 28 }); } },
      git: { async status(): Promise<ReturnType<typeof ok>> { return ok({ entries: [] }); } },
    }, actor);

    const context = await registry.invoke('workspace_context', { query: 'login', workspaceId: 'workspace-1' });
    expect(context.isError).not.toBe(true);
    const stats = await registry.invoke('context_economy_stats', {});
    expect(stats.isError).not.toBe(true);
    expect(stats).toMatchObject({ structuredContent: { filesDiscovered: 1, filesDelivered: 1 } });
  });

  it('persists redacted session state and reports task execution unavailable truthfully', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-'));
    const statePath = path.join(directory, 'runtime.json');
    const first = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    await first.execute('session_checkpoint', { summary: 'inspect logs', token: 'must-not-be-retained' });
    const second = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    const resumed = await second.execute('session_context', {});
    expect(resumed).toMatchObject({ ok: true, value: { checkpoints: [{ summary: 'inspect logs' }] } });
    const task = await second.execute('task_create', { instruction: 'run tests' });
    expect(task).toMatchObject({
      ok: true,
      value: {
        tool: 'task_create', status: 'needs_setup', available: false, ready: false, executed: false,
        requirements: ['local shell task runtime'],
      },
    });
  });

  it('rejects task_create bound to a terminal goal before starting a shell task', async () => {
    const calls: unknown[] = [];
    const services = {
      capabilities: {
        async execute(tool: string, input: unknown): Promise<ReturnType<typeof ok>> {
          calls.push({ tool, input });
          return ok({ started: true });
        },
      },
      goals: {
        async getGoal() {
          return ok({ status: 'completed' });
        },
      },
    } as unknown as McpApplicationServices;
    const runtime = new UpgradeRuntimeService(services, actor);
    const taskTool = new ToolRegistry(services, actor).listAll().find((tool) => tool.name === 'task_create');
    expect(taskTool).toBeDefined();
    expect(taskTool?.parse({
      goalId: 'terminal-goal',
      executable: 'node.exe',
      goalLease: { goalId: 'terminal-goal', leaseToken: 'lease-token', leaseGeneration: 1 },
    })).toMatchObject({ ok: true });

    await expect(runtime.execute('task_create', { goalId: 'terminal-goal', executable: 'node.exe' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(calls).toEqual([]);
  });

  it('bounds task_status output polling while task_result remains the full-result path', async () => {
    const calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
    const longOutput = `prefix-${'x'.repeat(40_000)}-tail`;
    const services = {
      capabilities: {
        async execute(tool: string, input: Record<string, unknown>): Promise<ReturnType<typeof ok>> {
          calls.push({ tool, input });
          return ok({ task_id: 'task-1', state: 'running', stdout: longOutput });
        },
      },
    } as unknown as McpApplicationServices;
    const runtime = new UpgradeRuntimeService(services, actor);

    const status = await runtime.execute('task_status', { workspaceId: 'ws-1', taskId: 'task-1' });
    const result = await runtime.execute('task_result', { workspaceId: 'ws-1', taskId: 'task-1' });

    expect(status).toMatchObject({ ok: true, value: { status_output_truncated: true } });
    if (status.ok) {
      const value = status.value as Record<string, unknown>;
      expect(value.stdout).toHaveLength(32_768);
      expect(value.stdout).toEqual(expect.stringMatching(/-tail$/));
    }
    expect(result).toMatchObject({ ok: true, value: { stdout: longOutput } });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      tool: 'shell',
      input: { operation: 'status', task_id: 'task-1', tail_lines: 80, include_stdout: true, include_stderr: true },
    });
    expect(calls[1]).toMatchObject({
      tool: 'shell',
      input: { operation: 'result', task_id: 'task-1', include_stdout: true, include_stderr: true },
    });
    expect(calls[1]?.input).not.toHaveProperty('tail_lines');
  });

  it('keeps Git worktree spawning path-scoped and dry-run first', async () => {
    const calls: unknown[] = [];
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          calls.push(request);
          return ok({ exitCode: 0, stdout: 'worktree ready', stderr: '' });
        },
      },
    }, actor);

    await expect(runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', ref: 'main' })).resolves.toMatchObject({ ok: true, value: { dryRun: true, sideEffectsStarted: false } });
    await expect(runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '..\\outside', ref: 'main', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
    await expect(runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', ref: 'main', dryRun: false })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    const createdAgent = await runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', ref: 'main', dryRun: false, userConfirmed: true });
    expect(createdAgent).toMatchObject({ ok: true, value: { status: 'completed', sideEffectsStarted: true, worktreeLeaseGeneration: 1 } });
    if (!createdAgent.ok) throw new Error('worktree create failed');
    const createdAgentLease = createdAgent.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
    expect(calls).toEqual([{ workspaceId: 'ws-1', args: ['worktree', 'add', '--detach', '.worktrees/agent-1', 'main'] }]);

    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/unknown' })).resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_NOT_FOUND' } });
    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1' })).resolves.toMatchObject({ ok: true, value: { dryRun: true } });
    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', dryRun: false })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1',
      worktreeLeaseToken: createdAgentLease.worktreeLeaseToken,
      worktreeLeaseGeneration: createdAgentLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(calls.at(-1)).toMatchObject({ args: ['worktree', 'remove', '.worktrees/agent-1'] });
    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_NOT_FOUND' } });

    await expect(runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: 'E:\\outside\\agent-1', ref: 'main', dryRun: false,
    }, undefined, fullBypassAuthorization)).resolves.toMatchObject({ ok: true, value: { status: 'completed', worktreePath: 'E:/outside/agent-1' } });
    expect(calls.at(-1)).toMatchObject({ args: ['worktree', 'add', '--detach', 'E:/outside/agent-1', 'main'] });
  });

  it('fails closed on malformed write swarm planner metadata', async () => {
    const runtime = new UpgradeRuntimeService({ platform: 'win32' }, actor);

    await expect(runtime.execute('write_swarm_run', {
      workspaceId: 'ws-1',
      tasks: [{ id: 'a', prompt: 'A', collisionKeys: 'src/a.ts' }],
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    await expect(runtime.execute('write_swarm_run', {
      workspaceId: 'ws-1',
      tasks: [{ id: 'a', prompt: 'A', complexity: 'huge' }],
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    await expect(runtime.execute('write_swarm_run', {
      workspaceId: 'ws-1',
      tasks: [{ id: 'a', prompt: 'A' }],
      executionStrategy: 'sometimes',
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    await expect(runtime.execute('write_swarm_run', {
      workspaceId: 'ws-1',
      tasks: [{ id: 'a', prompt: 'A' }],
      maxConcurrency: 9,
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('runs a write swarm worker in an isolated worktree, captures its patch, sanitizes it, and returns it to the pool', async () => {
    const gitCalls: Array<{ workspaceId: string; args: readonly string[]; cwd?: string }> = [];
    const codexCalls: Array<{ workspaceId: string; sandboxMode?: string }> = [];
    let workerStatusReads = 0;
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      workspaceInfo: {
        async info(): Promise<ReturnType<typeof ok>> {
          return ok({ id: 'ws-1', rootPath: 'C:\\repo', realRootPath: 'C:\\repo' });
        },
        async register(_actor, request): Promise<ReturnType<typeof ok>> {
          return ok({ id: 'worker-1', rootPath: request.path, realRootPath: request.path });
        },
      },
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          gitCalls.push({ workspaceId: request.workspaceId, args: request.args, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) });
          if (request.workspaceId === 'worker-1' && request.args[0] === 'status') {
            workerStatusReads += 1;
            return ok({ exitCode: 0, stdout: workerStatusReads === 1 ? ' M src/worker.ts\n' : '', stderr: '' });
          }
          if (request.workspaceId === 'worker-1' && request.args[0] === 'diff') {
            return ok({ exitCode: 0, stdout: 'diff --git a/src/worker.ts b/src/worker.ts\n+captured\n', stderr: '' });
          }
          return ok({ exitCode: 0, stdout: '', stderr: '' });
        },
      },
      codex: {
        async run(_actor, workspaceId, _instruction, _signal, _userConfirmed, _authorization, sandboxMode): Promise<ReturnType<typeof ok>> {
          codexCalls.push({ workspaceId, sandboxMode });
          return ok({ codexTaskId: 'codex-write-1', processId: 'process-write-1' });
        },
        async taskStatus(): Promise<ReturnType<typeof ok>> {
          return ok({
            processId: 'process-write-1', executable: 'codex', args: ['exec'], cwd: 'C:\\repo\\.worktrees\\worker',
            state: 'exited', startedAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T00:00:01.000Z', exitCode: 0,
          });
        },
        async taskLogs(): Promise<ReturnType<typeof ok>> {
          return ok({ entries: [{ sequence: 1, stream: 'stdout', text: 'worker complete\n' }], truncated: false, nextSequence: 2 });
        },
        async stop(): Promise<ReturnType<typeof ok>> {
          return ok(undefined);
        },
      },
    }, actor);

    const result = await runtime.execute('write_swarm_run', {
      workspaceId: 'ws-1',
      tasks: [{ id: 'worker', prompt: 'Edit only src/worker.ts.', collisionKeys: ['src/worker.ts'] }],
      executionStrategy: 'auto',
      reuseIdle: true,
      dependencyFingerprint: 'lock-v1',
      dryRun: false,
      userConfirmed: true,
    }, undefined, fullBypassAuthorization);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'completed',
        executionDecision: { mode: 'serial', maxConcurrency: 1, dependencyEdges: 0 },
        tasks: [{
          id: 'worker',
          state: 'completed',
          evidence: {
            patch: expect.stringContaining('src/worker.ts'),
            pooled: true,
            preserved: false,
            untrackedFiles: [],
          },
        }],
      },
    });
    expect(codexCalls).toEqual([{ workspaceId: 'worker-1', sandboxMode: 'workspace-write' }]);
    expect(gitCalls.some((call) => call.args[0] === 'worktree' && call.args[1] === 'add')).toBe(true);
    expect(gitCalls.some((call) => call.workspaceId === 'worker-1' && call.args[0] === 'reset' && call.args[1] === '--hard')).toBe(true);
  });

  it('preserves successful write workers with untracked output instead of pooling them', async () => {
    let resetCalled = false;
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      workspaceInfo: {
        async info(): Promise<ReturnType<typeof ok>> {
          return ok({ id: 'ws-1', rootPath: 'C:\\repo', realRootPath: 'C:\\repo' });
        },
        async register(_actor, request): Promise<ReturnType<typeof ok>> {
          return ok({ id: 'worker-untracked', rootPath: request.path, realRootPath: request.path });
        },
      },
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          if (request.workspaceId === 'worker-untracked' && request.args[0] === 'status') {
            return ok({ exitCode: 0, stdout: '?? NEW_FILE.txt\n', stderr: '' });
          }
          if (request.workspaceId === 'worker-untracked' && request.args[0] === 'diff') {
            return ok({ exitCode: 0, stdout: '', stderr: '' });
          }
          if (request.workspaceId === 'worker-untracked' && request.args[0] === 'reset') {
            resetCalled = true;
          }
          return ok({ exitCode: 0, stdout: '', stderr: '' });
        },
      },
      codex: {
        async run(): Promise<ReturnType<typeof ok>> {
          return ok({ codexTaskId: 'codex-untracked', processId: 'process-untracked' });
        },
        async taskStatus(): Promise<ReturnType<typeof ok>> {
          return ok({
            processId: 'process-untracked', executable: 'codex', args: ['exec'], cwd: 'C:\\repo\\.worktrees\\worker-untracked',
            state: 'exited', startedAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T00:00:01.000Z', exitCode: 0,
          });
        },
        async taskLogs(): Promise<ReturnType<typeof ok>> {
          return ok({ entries: [], truncated: false, nextSequence: 0 });
        },
        async stop(): Promise<ReturnType<typeof ok>> {
          return ok(undefined);
        },
      },
    }, actor);

    const result = await runtime.execute('write_swarm_run', {
      workspaceId: 'ws-1',
      tasks: [{ id: 'untracked', prompt: 'Create NEW_FILE.txt.' }],
      dryRun: false,
      userConfirmed: true,
      reuseIdle: false,
    }, undefined, fullBypassAuthorization);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'completed',
        tasks: [{
          id: 'untracked',
          state: 'completed',
          evidence: {
            pooled: false,
            preserved: true,
            untrackedFiles: ['NEW_FILE.txt'],
          },
        }],
      },
    });
    expect(resetCalled).toBe(false);
  });

  it('preserves the worktree ownership ledger when Git add or remove exits non-zero', async () => {
    let failAdd = true;
    let failRemove = true;
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          if (request.args[1] === 'add' && failAdd) {
            return ok({ exitCode: 128, stdout: '', stderr: 'fatal: worktree path already exists' });
          }
          if (request.args[1] === 'remove' && failRemove) {
            return ok({ exitCode: 128, stdout: '', stderr: 'fatal: worktree contains modified files' });
          }
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      },
    }, actor);

    const input = { workspaceId: 'ws-1', worktreePath: '.worktrees/gc-agent', ref: 'main', dryRun: false, userConfirmed: true };
    await expect(runtime.execute('git_worktree_spawn', input)).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    failAdd = false;
    const createdGc = await runtime.execute('git_worktree_spawn', input);
    expect(createdGc).toMatchObject({ ok: true, value: { status: 'completed', ownershipLedger: true, worktreeLeaseGeneration: 1 } });
    if (!createdGc.ok) throw new Error('worktree create failed');
    const gcLease = createdGc.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };

    const removeInput = {
      workspaceId: 'ws-1', worktreePath: '.worktrees/gc-agent',
      worktreeLeaseToken: gcLease.worktreeLeaseToken,
      worktreeLeaseGeneration: gcLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    };
    await expect(runtime.execute('git_worktree_remove', removeInput)).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    failRemove = false;
    await expect(runtime.execute('git_worktree_remove', removeInput)).resolves.toMatchObject({ ok: true, value: { status: 'completed' } });
    await expect(runtime.execute('git_worktree_remove', removeInput)).resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_NOT_FOUND' } });
  });

  it('reuses only clean idle worktrees and reports dependency compatibility', async () => {
    const calls: Array<{ readonly args: readonly string[]; readonly cwd?: string }> = [];
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          calls.push({ args: request.args, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) });
          if (request.args[0] === 'status') return ok({ exitCode: 0, stdout: '', stderr: '' });
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      },
    }, actor);

    const created = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/pool-a', ref: 'base-a',
      dryRun: false, userConfirmed: true,
    });
    expect(created).toMatchObject({ ok: true, value: { reused: false, dependenciesReusable: false, worktreeLeaseGeneration: 1 } });
    if (!created.ok) throw new Error('worktree create failed');
    const firstLease = created.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };

    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/pool-a',
      retainIdle: true, evidenceCaptured: true, dependencyFingerprint: 'lock-v1',
      worktreeLeaseToken: firstLease.worktreeLeaseToken, worktreeLeaseGeneration: firstLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: true, value: { status: 'pooled', pooled: true, evicted: [], dependencyFingerprint: 'lock-v1' } });

    const reused = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/new-slot', ref: 'base-b',
      reuseIdle: true, dependencyFingerprint: 'lock-v1',
      dryRun: false, userConfirmed: true,
    });
    expect(reused).toMatchObject({
      ok: true,
      value: { reused: true, worktreePath: '.worktrees/pool-a', dependenciesReusable: true, worktreeLeaseGeneration: 2 },
    });
    if (!reused.ok) throw new Error('worktree reuse failed');
    const secondLease = reused.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
    expect(secondLease.worktreeLeaseToken).not.toBe(firstLease.worktreeLeaseToken);
    expect(calls.filter((call) => call.args[0] === 'worktree' && call.args[1] === 'add')).toHaveLength(1);
    expect(calls).toContainEqual({ cwd: '.worktrees/pool-a', args: ['switch', '--detach', 'base-b'] });

    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/pool-a',
      retainIdle: true, evidenceCaptured: true,
      worktreeLeaseToken: secondLease.worktreeLeaseToken, worktreeLeaseGeneration: secondLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: true, value: { dependencyFingerprint: null } });

    await expect(runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/new-slot-2', ref: 'base-c',
      reuseIdle: true, dependencyFingerprint: 'lock-v1',
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({
      ok: true,
      value: { reused: true, worktreePath: '.worktrees/pool-a', dependenciesReusable: false, worktreeLeaseGeneration: 3 },
    });
  });

  it('reuses an idle pool slot across later sessions of the same stable client', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-pool-'));
    try {
      const runtimeStatePath = path.join(directory, 'runtime.json');
      const git = {
        async run(_actor: FileActor, request: { readonly args: readonly string[] }): Promise<ReturnType<typeof ok>> {
          if (request.args[0] === 'status') return ok({ exitCode: 0, stdout: '', stderr: '' });
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      };
      const firstActor: FileActor = { clientId: 'stable-client', clientName: 'test', sessionId: 'session-a' };
      const secondActor: FileActor = { clientId: 'stable-client', clientName: 'test', sessionId: 'session-b' };
      const first = new UpgradeRuntimeService({ platform: 'win32', runtimeStatePath, git }, firstActor);
      const created = await first.execute('git_worktree_spawn', {
        workspaceId: 'ws-1', worktreePath: '.worktrees/persisted-a', ref: 'main',
        dryRun: false, userConfirmed: true,
      });
      if (!created.ok) throw new Error('worktree create failed');
      const lease = created.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
      await expect(first.execute('git_worktree_remove', {
        workspaceId: 'ws-1', worktreePath: '.worktrees/persisted-a',
        retainIdle: true, evidenceCaptured: true, dependencyFingerprint: 'lock-v1',
        worktreeLeaseToken: lease.worktreeLeaseToken, worktreeLeaseGeneration: lease.worktreeLeaseGeneration,
        dryRun: false, userConfirmed: true,
      })).resolves.toMatchObject({ ok: true, value: { pooled: true } });

      const second = new UpgradeRuntimeService({ platform: 'win32', runtimeStatePath, git }, secondActor);
      await expect(second.execute('git_worktree_spawn', {
        workspaceId: 'ws-1', worktreePath: '.worktrees/fallback', ref: 'next',
        reuseIdle: true, dependencyFingerprint: 'lock-v1',
        dryRun: false, userConfirmed: true,
      })).resolves.toMatchObject({
        ok: true,
        value: { reused: true, worktreePath: '.worktrees/persisted-a', dependenciesReusable: true, worktreeLeaseGeneration: 2 },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a stale release after a pooled worktree has been leased again', async () => {
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          if (request.args[0] === 'status') return ok({ exitCode: 0, stdout: '', stderr: '' });
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      },
    }, actor);

    const created = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/stale-a', ref: 'main',
      dryRun: false, userConfirmed: true,
    });
    if (!created.ok) throw new Error('worktree create failed');
    const staleLease = created.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
    await runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/stale-a',
      retainIdle: true, evidenceCaptured: true,
      worktreeLeaseToken: staleLease.worktreeLeaseToken, worktreeLeaseGeneration: staleLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    });
    const leasedAgain = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/fallback', ref: 'next',
      reuseIdle: true, dryRun: false, userConfirmed: true,
    });
    expect(leasedAgain).toMatchObject({ ok: true, value: { reused: true, worktreeLeaseGeneration: 2 } });

    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/stale-a',
      retainIdle: true, evidenceCaptured: true,
      worktreeLeaseToken: staleLease.worktreeLeaseToken, worktreeLeaseGeneration: staleLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('refuses dirty pool release and never reuses that worktree', async () => {
    let dirty = false;
    const calls: Array<{ readonly args: readonly string[]; readonly cwd?: string }> = [];
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          calls.push({ args: request.args, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) });
          if (request.args[0] === 'status') {
            return ok({ exitCode: 0, stdout: dirty ? '?? unfinished.txt\n' : '', stderr: '' });
          }
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      },
    }, actor);

    const created = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/dirty-a', ref: 'main',
      dryRun: false, userConfirmed: true,
    });
    if (!created.ok) throw new Error('worktree create failed');
    const lease = created.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
    dirty = true;
    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/dirty-a',
      retainIdle: true, evidenceCaptured: true,
      worktreeLeaseToken: lease.worktreeLeaseToken, worktreeLeaseGeneration: lease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });

    dirty = false;
    await expect(runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/clean-b', ref: 'main',
      reuseIdle: true, dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({
      ok: true,
      value: { reused: false, worktreePath: '.worktrees/clean-b' },
    });
    expect(calls.filter((call) => call.args[0] === 'worktree' && call.args[1] === 'add')).toHaveLength(2);
  });

  it('leases different idle worktrees concurrently and evicts the oldest clean idle slot', async () => {
    const calls: Array<{ readonly args: readonly string[]; readonly cwd?: string }> = [];
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          calls.push({ args: request.args, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) });
          if (request.args[0] === 'status') return ok({ exitCode: 0, stdout: '', stderr: '' });
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      },
    }, actor);

    for (const name of ['pool-1', 'pool-2', 'pool-3']) {
      const created = await runtime.execute('git_worktree_spawn', {
        workspaceId: 'ws-1', worktreePath: `.worktrees/${name}`, ref: 'main',
        dryRun: false, userConfirmed: true,
      });
      if (!created.ok) throw new Error('worktree create failed');
      const lease = created.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
      await runtime.execute('git_worktree_remove', {
        workspaceId: 'ws-1', worktreePath: `.worktrees/${name}`,
        retainIdle: true, evidenceCaptured: true, maxIdle: 2,
        worktreeLeaseToken: lease.worktreeLeaseToken, worktreeLeaseGeneration: lease.worktreeLeaseGeneration,
        dryRun: false, userConfirmed: true,
      });
    }

    expect(calls).toContainEqual({ args: ['worktree', 'remove', '.worktrees/pool-1'] });

    const [first, second] = await Promise.all([
      runtime.execute('git_worktree_spawn', {
        workspaceId: 'ws-1', worktreePath: '.worktrees/fallback-1', ref: 'next-a',
        reuseIdle: true, dryRun: false, userConfirmed: true,
      }),
      runtime.execute('git_worktree_spawn', {
        workspaceId: 'ws-1', worktreePath: '.worktrees/fallback-2', ref: 'next-b',
        reuseIdle: true, dryRun: false, userConfirmed: true,
      }),
    ]);
    expect(first).toMatchObject({ ok: true, value: { reused: true } });
    expect(second).toMatchObject({ ok: true, value: { reused: true } });
    if (first.ok && second.ok) {
      expect((first.value as { worktreePath: string }).worktreePath)
        .not.toBe((second.value as { worktreePath: string }).worktreePath);
    }
  });

  it('does not lease a worktree while that slot is reserved for eviction', async () => {
    let blockPoolOneStatus = false;
    let announceEviction!: () => void;
    let continueEviction!: () => void;
    const evictionStarted = new Promise<void>((resolve) => { announceEviction = resolve; });
    const evictionContinue = new Promise<void>((resolve) => { continueEviction = resolve; });
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          if (request.args[0] === 'status' && request.cwd === '.worktrees/evict-1' && blockPoolOneStatus) {
            announceEviction();
            await evictionContinue;
          }
          if (request.args[0] === 'status') return ok({ exitCode: 0, stdout: '', stderr: '' });
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      },
    }, actor);

    for (const name of ['evict-1', 'evict-2']) {
      const created = await runtime.execute('git_worktree_spawn', {
        workspaceId: 'ws-1', worktreePath: `.worktrees/${name}`, ref: 'main',
        dryRun: false, userConfirmed: true,
      });
      if (!created.ok) throw new Error('worktree create failed');
      const lease = created.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
      await runtime.execute('git_worktree_remove', {
        workspaceId: 'ws-1', worktreePath: `.worktrees/${name}`,
        retainIdle: true, evidenceCaptured: true, maxIdle: 2,
        worktreeLeaseToken: lease.worktreeLeaseToken, worktreeLeaseGeneration: lease.worktreeLeaseGeneration,
        dryRun: false, userConfirmed: true,
      });
    }

    const third = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/evict-3', ref: 'main',
      dryRun: false, userConfirmed: true,
    });
    if (!third.ok) throw new Error('worktree create failed');
    const thirdLease = third.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
    blockPoolOneStatus = true;
    const releaseThird = runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/evict-3',
      retainIdle: true, evidenceCaptured: true, maxIdle: 2,
      worktreeLeaseToken: thirdLease.worktreeLeaseToken, worktreeLeaseGeneration: thirdLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    });

    await evictionStarted;
    const concurrentLease = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/fallback', ref: 'next',
      reuseIdle: true, dryRun: false, userConfirmed: true,
    });
    expect(concurrentLease).toMatchObject({ ok: true, value: { reused: true, worktreePath: '.worktrees/evict-2' } });
    continueEviction();
    await expect(releaseThird).resolves.toMatchObject({ ok: true, value: { evicted: ['.worktrees/evict-1'] } });
  });

  it('prevents ordinary removal from racing a newly reused active lease', async () => {
    let blockReuseStatus = false;
    let announceReuseClaim!: () => void;
    let continueReuse!: () => void;
    const reuseClaimed = new Promise<void>((resolve) => { announceReuseClaim = resolve; });
    const reuseContinue = new Promise<void>((resolve) => { continueReuse = resolve; });
    const calls: Array<{ readonly args: readonly string[]; readonly cwd?: string }> = [];
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          calls.push({ args: request.args, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) });
          if (request.args[0] === 'status' && request.cwd === '.worktrees/remove-race' && blockReuseStatus) {
            announceReuseClaim();
            await reuseContinue;
          }
          if (request.args[0] === 'status') return ok({ exitCode: 0, stdout: '', stderr: '' });
          return ok({ exitCode: 0, stdout: 'ok', stderr: '' });
        },
      },
    }, actor);

    const created = await runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/remove-race', ref: 'main',
      dryRun: false, userConfirmed: true,
    });
    if (!created.ok) throw new Error('worktree create failed');
    const firstLease = created.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };
    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/remove-race',
      retainIdle: true, evidenceCaptured: true,
      worktreeLeaseToken: firstLease.worktreeLeaseToken,
      worktreeLeaseGeneration: firstLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: true, value: { pooled: true } });

    blockReuseStatus = true;
    const reuse = runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/fallback-remove-race', ref: 'next',
      reuseIdle: true, dryRun: false, userConfirmed: true,
    });
    await reuseClaimed;

    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/remove-race',
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/remove-race',
      worktreeLeaseToken: firstLease.worktreeLeaseToken,
      worktreeLeaseGeneration: firstLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(calls.filter((call) => call.args[0] === 'worktree' && call.args[1] === 'remove')).toHaveLength(0);

    continueReuse();
    const reused = await reuse;
    expect(reused).toMatchObject({ ok: true, value: { reused: true, worktreeLeaseGeneration: 2 } });
    if (!reused.ok) throw new Error('worktree reuse failed');
    const currentLease = reused.value as { worktreeLeaseToken: string; worktreeLeaseGeneration: number };

    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-1', worktreePath: '.worktrees/remove-race',
      worktreeLeaseToken: currentLease.worktreeLeaseToken,
      worktreeLeaseGeneration: currentLease.worktreeLeaseGeneration,
      dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(calls.filter((call) => call.args[0] === 'worktree' && call.args[1] === 'remove')).toHaveLength(1);
  });

  it('uses POSIX worktree syntax without rewriting foreign Windows paths', async () => {
    const calls: unknown[] = [];
    const runtime = new UpgradeRuntimeService({
      platform: 'linux',
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          calls.push(request);
          return ok({ exitCode: 0, stdout: 'worktree ready', stderr: '' });
        },
      },
    }, actor);

    await expect(runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-linux', worktreePath: '..\\outside', ref: 'main', dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-linux', worktreePath: '../outside', ref: 'main', dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
    await expect(runtime.execute('git_worktree_spawn', {
      workspaceId: 'ws-linux', worktreePath: '.worktrees/agent-1', ref: 'main', dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: true, value: { status: 'completed', worktreePath: '.worktrees/agent-1' } });
    expect(calls).toEqual([{ workspaceId: 'ws-linux', args: ['worktree', 'add', '--detach', '.worktrees/agent-1', 'main'] }]);
    await expect(runtime.execute('git_worktree_remove', {
      workspaceId: 'ws-linux', worktreePath: '.worktrees\\agent-1', dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('validates Ponytail workspace overrides before project profile persistence', async () => {
    const runtime = new UpgradeRuntimeService({
      file: {
        async writeFile(): Promise<ReturnType<typeof ok>> { return ok({ path: '.lnwjud/project-profile.json' }); },
      } as McpApplicationServices['file'],
    }, actor);

    await expect(runtime.execute('project_profile_set', {
      workspaceId: 'workspace-1', profile: { language: 'typescript', ponytail: { mode: 'full' } },
    })).resolves.toMatchObject({
      ok: true, value: { dryRun: true, executed: false, profile: { ponytail: { mode: 'full' } } },
    });
    await expect(runtime.execute('project_profile_set', {
      workspaceId: 'workspace-1', profile: { ponytail: { mode: 'inherit' } },
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(runtime.execute('project_profile_set', {
      workspaceId: 'workspace-1', profile: { ponytail: 'full' },
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('uses trusted Full Bypass for inner always-confirm upgrade mutations', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    await runtime.execute('hook_register', { name: 'audit', event: 'beforeTool' });

    await expect(runtime.execute('hook_remove', { name: 'audit' }, undefined, fullBypassAuthorization))
      .resolves.toMatchObject({ ok: true, value: { removed: true } });
    await expect(runtime.execute('permission_check', { action: 'filesystem.delete' }, undefined, fullBypassAuthorization))
      .resolves.toMatchObject({ ok: true, value: { decision: 'allow', standardDecision: 'ask', authorizationMode: 'full_bypass' } });
    await expect(runtime.execute('permission_profile', {}, undefined, fullBypassAuthorization))
      .resolves.toMatchObject({ ok: true, value: { dangerousActions: 'application-approval-bypassed', hardBlocksRemain: false, operatingSystemAndRemotePolicyRemain: true } });
  });

  it('routes PowerPoint and Outlook upgrade tools into the Office capability', async () => {
    const calls: Record<string, unknown>[] = [];
    const runtime = new UpgradeRuntimeService({
      platform: 'win32',
      capabilities: {
        async execute(tool: string, request: Record<string, unknown>): Promise<ReturnType<typeof ok>> {
          expect(tool).toBe('office');
          calls.push(request);
          return ok({ app: request.app, action: request.action, ok: true });
        },
      },
      file: {
        async prepareExternalFileMutation(_actor, _workspaceId, request): Promise<ReturnType<typeof ok>> {
          return ok({
            sourcePaths: [...(request.sourcePaths ?? [])],
            targetPath: request.targetPath,
            targetRelativePath: 'copy.pptx',
            replacementBackup: { recoveryId: 'backup-1', recoveryPath: 'C:\\recovery\\backup-1\\payload' },
          });
        },
      } as McpApplicationServices['file'],
    }, actor);

    await expect(runtime.execute('office_ppt', { action: 'read', file_path: 'C:\\work\\deck.pptx' })).resolves.toMatchObject({
      ok: true, value: { executed: true, action: 'read' },
    });
    await expect(runtime.execute('office_ppt', { action: 'save_as', file_path: 'C:\\work\\deck.pptx', target_path: 'C:\\work\\copy.pptx' })).resolves.toMatchObject({
      ok: true, value: { dryRun: true, executed: false },
    });
    await expect(runtime.execute('office_ppt', {
      workspaceId: 'ws-1', action: 'save_as', file_path: 'C:\\work\\deck.pptx', target_path: 'C:\\work\\copy.pptx', dryRun: false, userConfirmed: true,
    })).resolves.toMatchObject({
      ok: true,
      value: { dryRun: false, executed: true, replacementBackup: { recoveryId: 'backup-1' } },
    });
    await expect(runtime.execute('office_outlook', { action: 'list_messages', folder: '\\Mailbox\\Inbox', max_messages: 250 })).resolves.toMatchObject({
      ok: true, value: { available: true, action: 'list_messages' },
    });
    expect(calls).toEqual([
      { app: 'powerpoint', action: 'read', file_path: 'C:\\work\\deck.pptx' },
      { app: 'powerpoint', action: 'save_as', file_path: 'C:\\work\\deck.pptx', target_path: 'C:\\work\\copy.pptx', userConfirmed: true },
      { app: 'outlook', action: 'list_messages', folder: '\\Mailbox\\Inbox', max_messages: 100, timeout_seconds: 60 },
    ]);
  });

  it('keeps the 50-prompt routing golden set in the top-20 with a local p95 budget', async () => {
    const templates = [
      ['run a Linux WSL developer command', 'wsl_exec'],
      ['capture a numbered native UI observation', 'vision_annotated_capture'],
      ['control a native desktop app with mouse and keyboard', 'computer_use'],
      ['read Thai and English text with offline OCR', 'vision'],
      ['detonate an artifact offline in Windows Sandbox', 'sandbox_exec'],
      ['watch an allowlisted ETW event provider', 'event_watch'],
      ['show TypeScript compiler diagnostics from LSP', 'lsp_diagnostics'],
      ['rename a symbol with a cross-file LSP edit plan', 'lsp_rename'],
      ['attach to an owned DAP debug adapter', 'debug_attach'],
      ['step the debugger and inspect locals', 'debug_step'],
      ['spawn an isolated Git worktree', 'git_worktree_spawn'],
      ['inspect the local database schema', 'db_inspect'],
      ['run a bounded local SQL database query', 'db_query'],
      ['create a PowerPoint slide through Office', 'office_ppt'],
      ['draft an Outlook message through Office', 'office_outlook'],
      ['extract tables from a PDF', 'pdf_extract_tables'],
      ['merge DOCX documents after approval', 'docx_merge'],
      ['plan a safe reversible self-healing fix', 'self_heal_plan'],
      ['import a compatible local agent skill', 'skills_import'],
      ['plan an owned parallel agent swarm', 'agent_swarm_run'],
      ['discover connected MCP servers in the hub', 'mcp_hub'],
      ['run a bounded shell process', 'shell'],
      ['act on a revalidated marked UI control', 'ui_target_action'],
      ['translate a registered Windows path to WSL', 'wsl_fs'],
      ['inspect context economy telemetry', 'context_economy_stats'],
      ['discover project tests', 'discover_tests'],
    ] as const;
    const golden = Array.from({ length: 50 }, (_, index) => ({ query: `${templates[index % templates.length]![0]} ${index}`, target: templates[index % templates.length]![1] }));
    const runtime = new UpgradeRuntimeService({}, actor);
    const latencies: number[] = [];
    for (const prompt of golden) {
      const started = performance.now();
      const result = await runtime.execute('tool_dynamic_filter', { query: prompt.query, limit: 20 });
      latencies.push(performance.now() - started);
      expect(result).toMatchObject({ ok: true, value: { rankedCandidates: expect.any(Array), primitiveToolsRemainAvailable: true } });
      if (result.ok) expect(result.value.rankedCandidates.map((candidate) => candidate.name)).toContain(prompt.target);
    }
    const sorted = [...latencies].sort((left, right) => left - right);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThan(50);
  });

describe('self-healing (Wave 8)', () => {
  it('plans safe reversible fixes from live evidence', async () => {
    const staleStart = new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString();
    const runtime = new UpgradeRuntimeService({
      workspaceIndex: {
        async status(): Promise<ReturnType<typeof ok>> { return ok({ indexed: false, snapshot: null }); },
        async indexWorkspace(): Promise<ReturnType<typeof ok>> { return ok({ entries: [] }); },
      },
      capabilities: {
        async execute(_tool: string, request: { operation?: string }): Promise<ReturnType<typeof ok>> {
          if (request.operation === 'list') {
            return ok({ tasks: [
              { task_id: 'stale-1', state: 'running', durable: true, started_at: staleStart },
              { task_id: 'fresh-1', state: 'running', durable: true, started_at: new Date().toISOString() },
              { task_id: 'done-1', state: 'completed', durable: true, started_at: staleStart },
            ] });
          }
          expect(request.operation).toBe('cancel');
          return ok({ task_id: request.task_id, state: 'cancelled' });
        },
      },
    }, actor);

    const plan = await runtime.execute('self_heal_plan', { workspaceId: 'ws-1' });
    expect(plan).toMatchObject({ ok: true, value: {
      tool: 'self_heal_plan', applied: false, planId: expect.any(String), mutationRequired: true, automaticDestructiveRetry: false,
      evidence: { index: { indexed: false }, durableTasks: { staleOlderThan24h: 1 } },
      safeReversibleFixes: [
        expect.objectContaining({ id: 'reindex-workspace', kind: 'reindex_workspace', requiresConfirmation: false }),
        expect.objectContaining({ id: 'cancel-stale-task-stale-1', kind: 'cancel_stale_task', requiresConfirmation: true }),
      ],
    } });

    await expect(runtime.execute('self_heal_apply', { workspaceId: 'ws-1' })).resolves.toMatchObject({ ok: true, value: { dryRun: true, applied: [] } });
    await expect(runtime.execute('self_heal_apply', { workspaceId: 'ws-1', dryRun: false })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(runtime.execute('self_heal_apply', { workspaceId: 'ws-1', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    if (!plan.ok) throw new Error('plan should be available');
    const planId = String((plan.value as { planId: string }).planId);
    const applied = await runtime.execute('self_heal_apply', { workspaceId: 'ws-1', planId, dryRun: false, userConfirmed: true, fixIds: ['cancel-stale-task-stale-1'] });
    expect(applied).toMatchObject({ ok: true, value: {
      dryRun: false, automaticDestructiveRetry: false,
      applied: [expect.objectContaining({ id: 'cancel-stale-task-stale-1', ok: true })],
    } });
  });

  it('reports an empty plan when everything is healthy', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const plan = await runtime.execute('self_heal_plan', {});
    expect(plan).toMatchObject({ ok: true, value: { safeReversibleFixes: [], mutationRequired: false } });
  });
});
});
