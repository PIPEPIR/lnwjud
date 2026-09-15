import { describe, expect, it } from 'vitest';
import { ok } from '@lnwjud/domain';
import { ContextEconomyRuntime } from '../context-economy.js';
import { IncrementalVerifier } from '../incremental-verifier.js';
import { sessionTools } from './session-tools.js';
import type { McpToolContext, McpToolDefinition } from './tool-types.js';

const actor = { clientId: 'test-client', clientName: 'test' };

function findTool(context: McpToolContext, verifier: IncrementalVerifier, name: string): McpToolDefinition {
  const tool = sessionTools(context, verifier).find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('session tools', () => {
  it('creates a same-chat handoff from the real tracker content, git changes, and durable task IDs', async () => {
    const context = {
      actor,
      contextEconomy: new ContextEconomyRuntime(),
      services: {
        file: {
          async readFile() {
            return ok({
              path: 'docs/PHASE_PROGRESS.md',
              content: '# Tracker\n## Next chat startup probe\nRUN-SMOKE-42\n## Current phase\nPhase budget guard',
              startLine: 1,
              endLine: 5,
            });
          },
        },
        git: {
          async status() {
            return ok({ entries: [{ path: 'packages/mcp-server/src/run-budget.ts', index: ' ', worktree: 'M' }] });
          },
          async diff(_actor: unknown, _workspaceId: string, request: { staged?: boolean }) {
            return ok({ patch: request.staged === true ? '' : '+RUN-BUDGET-DIFF', truncated: false });
          },
        },
        capabilities: {
          async execute(tool: string, request: { operation?: string }) {
            expect(tool).toBe('shell');
            expect(request.operation).toBe('list');
            return ok({
              tasks: [
                { task_id: 'durable-123', state: 'running', durable: true, started_at: '2026-08-22T01:00:00.000Z' },
                { task_id: 'ephemeral-1', state: 'running', durable: false },
              ],
            });
          },
        },
      },
    } as unknown as McpToolContext;

    const response = await findTool(context, new IncrementalVerifier(), 'session_handoff').execute(
      { workspaceId: 'workspace-1' },
      new AbortController().signal,
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const value = response.value as Record<string, unknown>;
    expect(value.tracker_excerpt).toContain('RUN-SMOKE-42');
    expect(value.changed_files).toContain('packages/mcp-server/src/run-budget.ts');
    expect(value.background_tasks).toEqual([expect.objectContaining({ task_id: 'durable-123', state: 'running' })]);
    expect(value.prompt).toEqual(expect.stringContaining('Recovery state from lnwjud durable task state'));
    expect(value.recovery_state).toBe(value.prompt);
    expect(value.recovery_format).toBe('task_state');
    expect(value.persistent_instructions).toBe(false);
    expect(value.prompt).toEqual(expect.stringContaining('not persistent user or agent instructions'));
    expect(value.prompt).toEqual(expect.stringContaining('durable-123'));
    expect(value.prompt).toEqual(expect.stringContaining('Recover durable jobs by task_id'));
    expect(value.prompt).toEqual(expect.stringContaining('Do not redo completed phases'));
    expect(value.prompt).toEqual(expect.stringContaining('Never use browser/DOM automation'));
    expect(value.prompt).not.toEqual(expect.stringContaining('Before ending'));
  });

  it('uses the active durable goal and latest capsule even when the legacy tracker is unavailable', async () => {
    const context = {
      actor,
      contextEconomy: new ContextEconomyRuntime(),
      services: {
        goals: {
          async listGoals() {
            return ok({ goals: [{
              goalId: 'goal-v5', goalKey: 'v5', workspaceId: 'workspace-1', objective: 'Ship v5 safely', status: 'active', revision: 7,
              userIntentRevision: 2, currentPhase: 'verify', plan: { steps: [{ id: 'verify', title: 'Verify', status: 'in_progress' }] },
              acceptanceCriteria: [{ id: 'tests', title: 'Tests pass', status: 'pending' }], blockers: [], trackedTasks: [], nextAction: 'Run tests.',
              currentContextCapsuleId: 'capsule-v5', completedSteps: [], pendingSteps: [], activeTaskIds: [], lastCheckpoint: null,
            }] });
          },
          async listContextCapsules() {
            return ok([{ id: 'capsule-v5', goalId: 'goal-v5', sourceGoalRevision: 7, sourceUserIntentRevision: 2,
              payload: { objective: 'Ship v5 safely', userSteering: ['No browser automation'], currentPhase: 'verify', plan: { steps: [] }, acceptanceCriteria: [],
                completedWork: ['Implementation'], remainingWork: ['Verification'], decisions: ['Native scheduled tasks only'], validation: [], changedFiles: [], artifacts: [], blockers: [], nextAction: 'Run tests.' },
              createdAt: '2026-09-15T00:00:00.000Z' }]);
          },
        },
        git: {
          async status() { return ok({ entries: [] }); },
          async diff() { return ok({ patch: '', truncated: false }); },
        },
        capabilities: {
          async execute() { return ok({ tasks: [] }); },
        },
      },
    } as unknown as McpToolContext;

    const response = await findTool(context, new IncrementalVerifier(), 'session_handoff').execute(
      { workspaceId: 'workspace-1' },
      new AbortController().signal,
    );
    expect(response).toMatchObject({
      ok: true,
      value: {
        source_priority: ['durable_goal', 'context_capsule', 'git_workspace', 'legacy_tracker'],
        tracker_available: false,
        goal_state: { goalId: 'goal-v5', revision: 7, userIntentRevision: 2 },
        context_capsule: { id: 'capsule-v5', sourceGoalRevision: 7 },
      },
    });
    if (!response.ok) return;
    const value = response.value as Record<string, unknown>;
    expect(value.prompt).toEqual(expect.stringContaining('Ship v5 safely'));
    expect(value.prompt).toEqual(expect.stringContaining('Native scheduled tasks only'));
    expect(value.prompt).toEqual(expect.stringContaining('Never use browser/DOM automation'));
  });

  it('returns verify_incremental cache hit for unchanged diff and miss after the diff changes', async () => {
    let patch = '+first-diff';
    let starts = 0;
    const context = {
      actor,
      contextEconomy: new ContextEconomyRuntime(),
      services: {
        git: {
          async status() {
            return ok({ entries: [{ path: 'src/app.ts', index: ' ', worktree: 'M' }] });
          },
          async diff(_actor: unknown, _workspaceId: string, request: { staged?: boolean }) {
            return ok({ patch: request.staged === true ? '' : patch, truncated: false });
          },
        },
        process: {
          async startProjectCommand() {
            starts += 1;
            return ok({
              processId: `typecheck-${starts}`,
              executable: 'pnpm',
              args: ['typecheck'],
              cwd: 'E:/repo',
              state: 'exited' as const,
              startedAt: '2026-08-22T01:00:00.000Z',
              finishedAt: '2026-08-22T01:00:01.000Z',
              exitCode: 0,
            });
          },
          async status() {
            throw new Error('status should not be needed for an already-terminal start result');
          },
          async logs(_actor: unknown, _workspaceId: string, processId: string) {
            return ok({
              entries: [{ sequence: 1, stream: 'stdout' as const, text: `${processId}: typecheck passed` }],
              truncated: false,
              nextSequence: 2,
            });
          },
        },
      },
    } as unknown as McpToolContext;
    const verifier = new IncrementalVerifier();
    const tool = findTool(context, verifier, 'verify_incremental');
    const signal = new AbortController().signal;

    const first = await tool.execute({ workspaceId: 'workspace-1' }, signal);
    const second = await tool.execute({ workspaceId: 'workspace-1' }, signal);
    patch = '+second-diff';
    const third = await tool.execute({ workspaceId: 'workspace-1' }, signal);

    expect(first).toMatchObject({ ok: true, value: { cache: 'miss', passed: true } });
    expect(second).toMatchObject({ ok: true, value: { cache: 'hit', passed: true } });
    expect(third).toMatchObject({ ok: true, value: { cache: 'miss', passed: true } });
    expect(verifier.stats()).toMatchObject({ entries: 1, hits: 1, misses: 2, hitRate: 1 / 3 });
    expect(verifier.stats().bytesSaved).toBeGreaterThan(0);
    expect(verifier.invalidate('workspace-1')).toBe(1);
    expect(verifier.stats()).toMatchObject({ entries: 0, hits: 1, misses: 2 });
    expect(starts).toBe(2);
  });
});
