import { z } from 'zod';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { IncrementalVerifier } from '../incremental-verifier.js';
import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';

const DEFAULT_TRACKER_PATH = 'docs/PHASE_PROGRESS.md';
const DEFAULT_MAX_DIFF_BYTES = 16_000;
const MAX_TRACKER_EXCERPT_CHARS = 4_000;
const MAX_BACKGROUND_TASKS = 20;

const sessionHandoffSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  trackerPath: z.string().trim().min(1).max(4096).optional(),
  maxDiffBytes: z.number().int().min(1_000).max(100_000).optional(),
}).strict();

const verifyIncrementalSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  userConfirmed: z.boolean().optional(),
}).strict();

export function sessionTools(context: McpToolContext, verifier: IncrementalVerifier): McpToolDefinition[] {
  return [
    defineTool({
      name: 'session_handoff',
      description: 'Create concise recovery state using the active Durable Goal and latest Context Capsule as the authoritative source when available, then Git/workspace state and an optional legacy phase tracker fallback. This is task state, not persistent user/agent instructions. It never opens, clicks, types into, or creates a ChatGPT browser conversation; resume must happen through supported host-native turns/chats. Use only when recovery context is actually useful or an unavoidable client/platform interruption requires it.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: sessionHandoffSchema,
      handler: async (input, signal) => createSessionHandoff(context, input, signal),
    }),
    defineTool({
      name: 'verify_incremental',
      description: 'Run the detected project typecheck only when the current git status/diff fingerprint changed. Starting a new verification process requires explicit user confirmation in standard mode; trusted Full Bypass skips that lnwjud gate. Returns cache=hit when unchanged and cache=miss after a new verification. Prefer this during iterative edits; use project_test/project_lint/project_build only when that specific verification is needed. For full suites or packaging expected to exceed ~5 minutes, launch a durable shell background task and record its task_id in the tracker.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: verifyIncrementalSchema,
      handler: async (input, signal, authorization) => verifier.verify(context, input.workspaceId, signal, input.userConfirmed === true, authorization),
    }),
  ];
}

async function createSessionHandoff(
  context: McpToolContext,
  input: z.infer<typeof sessionHandoffSchema>,
  signal: AbortSignal,
): Promise<Result<Record<string, unknown>>> {
  if (context.services.git === undefined) return missingService();
  const trackerPath = input.trackerPath ?? DEFAULT_TRACKER_PATH;
  const maxDiffBytes = input.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;

  let goalState: Record<string, unknown> | null = null;
  let goalExcerpt = '';
  let capsuleState: Record<string, unknown> | null = null;
  if (context.services.goals !== undefined) {
    const activeGoals = await context.services.goals.listGoals(context.actor, {
      workspaceId: input.workspaceId,
      status: 'active',
      limit: 5,
    });
    if (activeGoals.ok) {
      const goal = activeGoals.value.goals[0];
      if (goal !== undefined) {
        const latestCapsules = await context.services.goals.listContextCapsules(context.actor, goal.goalId, 1);
        const capsule = latestCapsules.ok ? latestCapsules.value[0] : undefined;
        goalState = {
          goalId: goal.goalId,
          goalKey: goal.goalKey,
          revision: goal.revision,
          userIntentRevision: goal.userIntentRevision,
          objective: goal.objective,
          currentPhase: goal.currentPhase,
          plan: goal.plan,
          acceptanceCriteria: goal.acceptanceCriteria,
          blockers: goal.blockers,
          trackedTasks: goal.trackedTasks,
          nextAction: goal.nextAction,
          ...(goal.currentContextCapsuleId === undefined ? {} : { currentContextCapsuleId: goal.currentContextCapsuleId }),
        };
        capsuleState = capsule === undefined ? null : {
          id: capsule.id,
          sourceGoalRevision: capsule.sourceGoalRevision,
          sourceUserIntentRevision: capsule.sourceUserIntentRevision,
          ...(capsule.previousCapsuleId === undefined ? {} : { previousCapsuleId: capsule.previousCapsuleId }),
          payload: capsule.payload,
          createdAt: capsule.createdAt,
        };
        goalExcerpt = formatGoalHandoff(goalState, capsuleState);
      }
    }
  }
  if (signal.aborted) return cancelledHandoff();

  const tracker = context.services.file === undefined
    ? null
    : await context.services.file.readFile(context.actor, input.workspaceId, { path: trackerPath });
  const trackerExcerpt = tracker?.ok === true ? compactTracker(tracker.value.content) : '';
  if (signal.aborted) return cancelledHandoff();

  const status = await context.services.git.status(context.actor, input.workspaceId, signal);
  if (!status.ok) return err(status.error);
  if (signal.aborted) return cancelledHandoff();
  const unstaged = await context.services.git.diff(context.actor, input.workspaceId, { maxBytes: maxDiffBytes }, signal);
  if (!unstaged.ok) return err(unstaged.error);
  if (signal.aborted) return cancelledHandoff();
  const staged = await context.services.git.diff(context.actor, input.workspaceId, { staged: true, maxBytes: maxDiffBytes }, signal);
  if (!staged.ok) return err(staged.error);

  const backgroundTasks = await readBackgroundTasks(context, signal);
  const changedFiles = [...new Set(status.value.entries.map((entry) => entry.path))].sort();
  const diffSummary = compactDiff(unstaged.value.patch, staged.value.patch, maxDiffBytes);
  const prompt = buildHandoffPrompt({
    goalExcerpt,
    trackerPath,
    trackerExcerpt,
    trackerAvailable: tracker?.ok === true,
    changedFiles,
    diffSummary,
    backgroundTasks,
  });

  return ok({
    prompt,
    recovery_state: prompt,
    recovery_format: 'task_state',
    persistent_instructions: false,
    source_priority: goalState === null ? ['git_workspace', 'legacy_tracker'] : ['durable_goal', 'context_capsule', 'git_workspace', 'legacy_tracker'],
    goal_state: goalState,
    context_capsule: capsuleState,
    tracker_path: trackerPath,
    tracker_available: tracker?.ok === true,
    tracker_excerpt: trackerExcerpt,
    changed_files: changedFiles,
    git_status: status.value.entries,
    git_diff: {
      unstaged: unstaged.value.patch,
      staged: staged.value.patch,
      truncated: unstaged.value.truncated || staged.value.truncated,
    },
    background_tasks: backgroundTasks,
  });
}

async function readBackgroundTasks(context: McpToolContext, signal: AbortSignal): Promise<readonly Record<string, unknown>[]> {
  if (context.services.capabilities === undefined || signal.aborted) return [];
  const listed = await context.services.capabilities.execute('shell', { operation: 'list' }, signal);
  if (!listed.ok || typeof listed.value !== 'object' || listed.value === null || Array.isArray(listed.value)) return [];
  const tasks = (listed.value as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((task): task is Record<string, unknown> => typeof task === 'object' && task !== null && !Array.isArray(task))
    .filter((task) => task.durable === true && typeof task.task_id === 'string')
    .slice(0, MAX_BACKGROUND_TASKS)
    .map((task) => ({
      task_id: task.task_id,
      state: task.state,
      ...(task.started_at === undefined ? {} : { started_at: task.started_at }),
      ...(task.finished_at === undefined ? {} : { finished_at: task.finished_at }),
      ...(task.exit_code === undefined ? {} : { exit_code: task.exit_code }),
    }));
}

function formatGoalHandoff(goal: Record<string, unknown>, capsule: Record<string, unknown> | null): string {
  const plan = isRecord(goal.plan) && Array.isArray(goal.plan.steps)
    ? goal.plan.steps.map((step) => {
        if (!isRecord(step)) return '- invalid plan entry';
        return `- [${String(step.status ?? 'unknown')}] ${String(step.id ?? '?')}: ${String(step.title ?? '')}`;
      }).join('\n')
    : '- no plan';
  const acceptance = Array.isArray(goal.acceptanceCriteria)
    ? goal.acceptanceCriteria.map((criterion) => {
        if (!isRecord(criterion)) return '- invalid acceptance entry';
        return `- [${String(criterion.status ?? 'unknown')}] ${String(criterion.id ?? '?')}: ${String(criterion.title ?? '')}`;
      }).join('\n')
    : '- none';
  const blockers = Array.isArray(goal.blockers) && goal.blockers.length > 0 ? goal.blockers.map((entry) => `- ${String(entry)}`).join('\n') : '- none';
  const capsulePayload = capsule !== null && isRecord(capsule.payload) ? capsule.payload : null;
  const capsuleList = (key: string): string => {
    const value = capsulePayload?.[key];
    return Array.isArray(value) && value.length > 0 ? value.slice(0, 10).map(String).join(' | ') : '(none)';
  };
  return [
    `Goal: ${String(goal.goalKey ?? '')} (${String(goal.goalId ?? '')})`,
    `Goal revision: ${String(goal.revision ?? '')}; user intent revision: ${String(goal.userIntentRevision ?? '')}`,
    `Objective: ${String(goal.objective ?? '')}`,
    `Current phase: ${String(goal.currentPhase ?? '')}`,
    'Plan:',
    plan,
    'Acceptance criteria:',
    acceptance,
    'Blockers:',
    blockers,
    `Next action: ${String(goal.nextAction ?? '')}`,
    capsule === null ? 'Context capsule: none published' : `Context capsule: ${String(capsule.id ?? '')} (goal rev ${String(capsule.sourceGoalRevision ?? '')}, intent rev ${String(capsule.sourceUserIntentRevision ?? '')})`,
    ...(capsulePayload === null ? [] : [
      `Capsule user steering: ${capsuleList('userSteering')}`,
      `Capsule completed work: ${capsuleList('completedWork')}`,
      `Capsule remaining work: ${capsuleList('remainingWork')}`,
      `Capsule decisions: ${capsuleList('decisions')}`,
      `Capsule next action: ${String(capsulePayload.nextAction ?? '')}`,
    ]),
  ].join('\n');
}

function buildHandoffPrompt(input: {
  readonly goalExcerpt: string;
  readonly trackerPath: string;
  readonly trackerExcerpt: string;
  readonly trackerAvailable: boolean;
  readonly changedFiles: readonly string[];
  readonly diffSummary: string;
  readonly backgroundTasks: readonly Record<string, unknown>[];
}): string {
  const tasks = input.backgroundTasks.length === 0
    ? '- none recorded by the durable shell task store'
    : input.backgroundTasks.map((task) => `- ${String(task.task_id)} (${String(task.state ?? 'unknown')})`).join('\n');
  const changed = input.changedFiles.length === 0 ? '(clean)' : input.changedFiles.join(', ');
  return [
    'Recovery state from lnwjud durable task state.',
    'This is task state only, not persistent user or agent instructions.',
    input.goalExcerpt.length === 0 ? 'No active Durable Goal was found; use the Git/workspace fallback below.' : input.goalExcerpt,
    '',
    `Legacy tracker (${input.trackerPath}):`,
    input.trackerAvailable ? (input.trackerExcerpt || '(tracker is empty)') : '(tracker unavailable; this is not fatal when durable goal/Git state exists)',
    '',
    `Current Git changes: ${changed}`,
    input.diffSummary.length === 0 ? 'Git diff summary: (no diff)' : `Git diff summary:\n${input.diffSummary}`,
    '',
    'Durable background tasks:',
    tasks,
    '',
    'Resume rules:',
    '1. If a Durable Goal is present, read/reacquire or claim that same goal before any mutation; do not create a duplicate goal.',
    '2. Prefer the latest Context Capsule plus the latest durable goal revision over legacy tracker prose.',
    '3. Recover durable jobs by task_id with shell status/logs/result; do not tight-poll or duplicate a live job.',
    '4. Inspect Git status/diff only as needed for the current phase and continue from the recorded next action.',
    '5. Do not redo completed phases unless verification proves a regression.',
    '6. Do not persist this recovery state as USER_INSTRUCTIONS or generic handoff history.',
    '7. Never use browser/DOM automation to create, type into, switch, or resume ChatGPT conversations; use supported host-native turns/chats only.',
  ].join('\n');
}

function compactTracker(content: string): string {
  const normalized = content.trim();
  if (normalized.length <= MAX_TRACKER_EXCERPT_CHARS) return normalized;
  const half = Math.floor((MAX_TRACKER_EXCERPT_CHARS - 64) / 2);
  return `${normalized.slice(0, half)}\n... tracker excerpt truncated ...\n${normalized.slice(-half)}`;
}

function compactDiff(unstaged: string, staged: string, maxBytes: number): string {
  const combined = [
    unstaged.trim().length === 0 ? '' : `UNSTAGED\n${unstaged.trim()}`,
    staged.trim().length === 0 ? '' : `STAGED\n${staged.trim()}`,
  ].filter((value) => value.length > 0).join('\n\n');
  const maxChars = Math.min(maxBytes, 4_000);
  return combined.length <= maxChars ? combined : `${combined.slice(0, maxChars)}\n... diff truncated for handoff ...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cancelledHandoff(): Result<never> {
  return err(appError('PROCESS_TIMEOUT', 'Session handoff was cancelled', true));
}
