import { z } from 'zod';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { IncrementalVerifier } from '../incremental-verifier.js';
import { withCapabilityOwnerMetadata } from '../request-scope.js';
import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';

const DEFAULT_TRACKER_PATH = 'docs/PHASE_PROGRESS.md';
const DEFAULT_MAX_DIFF_BYTES = 16_000;
const MAX_TRACKER_EXCERPT_CHARS = 4_000;
const MAX_BACKGROUND_TASKS = 8;
const MAX_TASK_RECEIPT_CHARS = 1_200;
const MAX_TASK_RECEIPT_LINES = 12;

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
      description: 'Create concise recovery state after a client/page interruption or missing assistant summary without rerunning completed work. Prefer the active Durable Goal; when none exists, recover the latest terminal Durable Goal and its terminal receipt. Also inspect recent durable shell tasks with bounded status/output tails so a terminal result can be summarized immediately instead of relaunched. Then include Git/workspace state and an optional legacy phase tracker fallback. This is task state, not persistent user/agent instructions. It never opens, clicks, types into, or creates a ChatGPT browser conversation; resume must happen through supported host-native turns/chats.',
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
    const activeGoal = activeGoals.ok ? activeGoals.value.goals[0] : undefined;
    const latestGoals = activeGoal === undefined
      ? await context.services.goals.listGoals(context.actor, { workspaceId: input.workspaceId, limit: 1 })
      : null;
    const goal = activeGoal ?? (latestGoals?.ok === true ? latestGoals.value.goals[0] : undefined);
    if (goal !== undefined) {
      const latestCapsules = await context.services.goals.listContextCapsules(context.actor, goal.goalId, 1);
      const capsule = latestCapsules.ok ? latestCapsules.value[0] : undefined;
      goalState = {
        goalId: goal.goalId,
        goalKey: goal.goalKey,
        status: goal.status,
        revision: goal.revision,
        userIntentRevision: goal.userIntentRevision,
        objective: goal.objective,
        currentPhase: goal.currentPhase,
        plan: goal.plan,
        acceptanceCriteria: goal.acceptanceCriteria,
        blockers: goal.blockers,
        trackedTasks: goal.trackedTasks,
        nextAction: goal.nextAction,
        lastCheckpoint: goal.lastCheckpoint,
        updatedAt: goal.updatedAt,
        ...(goal.terminalSummary === undefined ? {} : { terminalSummary: goal.terminalSummary }),
        ...(goal.terminalEvidence === undefined ? {} : { terminalEvidence: goal.terminalEvidence }),
        ...(goal.terminalAt === undefined ? {} : { terminalAt: goal.terminalAt }),
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

  const backgroundTasks = await readBackgroundTasks(context, input.workspaceId, signal);
  const changedFiles = [...new Set(status.value.entries.map((entry) => entry.path))].sort();
  const diffSummary = compactDiff(unstaged.value.patch, staged.value.patch, maxDiffBytes);
  const hasCheckpointResumeContext = goalState !== null
    && isRecord(goalState.lastCheckpoint)
    && isRecord(goalState.lastCheckpoint.resumeContext);
  const prompt = buildHandoffPrompt({
    goalExcerpt,
    trackerPath,
    trackerExcerpt,
    trackerAvailable: tracker?.ok === true,
    changedFiles,
    diffSummary,
    backgroundTasks,
  });
  const recoveryReceipt = buildRecoveryReceipt(goalState, backgroundTasks);

  return ok({
    prompt,
    recovery_state: prompt,
    recovery_format: 'task_state',
    recovery_receipt: recoveryReceipt,
    persistent_instructions: false,
    source_priority: goalState === null
      ? ['git_workspace', 'legacy_tracker']
      : hasCheckpointResumeContext
        ? ['durable_goal', 'checkpoint_resume_context', 'context_capsule', 'git_workspace', 'legacy_tracker']
        : ['durable_goal', 'context_capsule', 'git_workspace', 'legacy_tracker'],
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

async function readBackgroundTasks(
  context: McpToolContext,
  workspaceId: string,
  signal: AbortSignal,
): Promise<readonly Record<string, unknown>[]> {
  if (context.services.capabilities === undefined || signal.aborted) return [];
  const listed = await context.services.capabilities.execute('shell', withCapabilityOwnerMetadata({
    operation: 'list',
    workspaceId,
    limit: MAX_BACKGROUND_TASKS,
  }, context.actor), signal);
  if (!listed.ok || typeof listed.value !== 'object' || listed.value === null || Array.isArray(listed.value)) return [];
  const tasks = (listed.value as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  const selected = tasks
    .filter((task): task is Record<string, unknown> => typeof task === 'object' && task !== null && !Array.isArray(task))
    .filter((task) => task.durable === true && typeof task.task_id === 'string')
    .slice(0, MAX_BACKGROUND_TASKS);
  return Promise.all(selected.map(async (task) => {
    if (signal.aborted) return taskReceipt(task);
    const observed = await context.services.capabilities!.execute('shell', withCapabilityOwnerMetadata({
      operation: 'status',
      workspaceId,
      task_id: task.task_id,
      tail_lines: MAX_TASK_RECEIPT_LINES,
      include_stdout: true,
      include_stderr: true,
    }, context.actor), signal);
    return taskReceipt(observed.ok && isRecord(observed.value) ? observed.value : task);
  }));
}

function taskReceipt(task: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: task.task_id,
    state: task.state,
    ...(task.started_at === undefined ? {} : { started_at: task.started_at }),
    ...(task.finished_at === undefined ? {} : { finished_at: task.finished_at }),
    ...(task.exit_code === undefined ? {} : { exit_code: task.exit_code }),
    ...(typeof task.error === 'string' && task.error.trim().length > 0 ? { error: compactTaskOutput(task.error) } : {}),
    ...(typeof task.stdout === 'string' && task.stdout.trim().length > 0 ? { stdout_tail: compactTaskOutput(task.stdout) } : {}),
    ...(typeof task.stderr === 'string' && task.stderr.trim().length > 0 ? { stderr_tail: compactTaskOutput(task.stderr) } : {}),
  };
}

function compactTaskOutput(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= MAX_TASK_RECEIPT_CHARS) return normalized;
  return `... task output truncated ...\n${normalized.slice(-MAX_TASK_RECEIPT_CHARS)}`;
}

function formatGoalHandoff(goal: Record<string, unknown>, capsule: Record<string, unknown> | null): string {
  const evidenceList = (value: unknown, limit = 20): string => {
    if (!Array.isArray(value) || value.length === 0) return '(none)';
    return value.slice(0, limit).map((entry) => {
      if (!isRecord(entry)) return 'invalid evidence';
      return `${String(entry.kind ?? 'note')}: ${String(entry.value ?? '')}`;
    }).join(' | ');
  };
  const plan = isRecord(goal.plan) && Array.isArray(goal.plan.steps)
    ? goal.plan.steps.map((step) => {
        if (!isRecord(step)) return '- invalid plan entry';
        return `- [${String(step.status ?? 'unknown')}] ${String(step.id ?? '?')}: ${String(step.title ?? '')}${step.summary === undefined ? '' : ` — ${String(step.summary)}`}`;
      }).join('\n')
    : '- no plan';
  const acceptance = Array.isArray(goal.acceptanceCriteria)
    ? goal.acceptanceCriteria.map((criterion) => {
        if (!isRecord(criterion)) return '- invalid acceptance entry';
        return `- [${String(criterion.status ?? 'unknown')}] ${String(criterion.id ?? '?')}: ${String(criterion.title ?? '')}; evidence: ${evidenceList(criterion.evidence, 10)}`;
      }).join('\n')
    : '- none';
  const blockers = Array.isArray(goal.blockers) && goal.blockers.length > 0 ? goal.blockers.map((entry) => `- ${String(entry)}`).join('\n') : '- none';
  const trackedTasks = Array.isArray(goal.trackedTasks) && goal.trackedTasks.length > 0
    ? goal.trackedTasks.slice(0, 50).map((entry) => {
        if (!isRecord(entry)) return '- invalid tracked task';
        return `- ${String(entry.taskId ?? '?')} [${String(entry.provider ?? 'unknown')}/${String(entry.role ?? 'unknown')}] cancelWithGoal=${String(entry.cancelWithGoal ?? false)}`;
      }).join('\n')
    : '- none';
  const checkpoint = isRecord(goal.lastCheckpoint) ? goal.lastCheckpoint : null;
  const resumeContext = checkpoint !== null && isRecord(checkpoint.resumeContext) ? checkpoint.resumeContext : null;
  const resumeList = (key: string): string => {
    const value = resumeContext?.[key];
    return Array.isArray(value) && value.length > 0 ? value.slice(0, 20).map(String).join(' | ') : '(none)';
  };
  const resumeCommands = resumeContext !== null && Array.isArray(resumeContext.commands) && resumeContext.commands.length > 0
    ? resumeContext.commands.slice(0, 20).map((entry) => {
        if (!isRecord(entry)) return 'invalid command record';
        return `${String(entry.status ?? 'unknown')}: ${String(entry.command ?? '')}${entry.exitCode === undefined ? '' : ` (exit ${String(entry.exitCode)})`}${entry.result === undefined ? '' : ` => ${String(entry.result)}`}`;
      }).join(' | ')
    : '(none)';
  const capsulePayload = capsule !== null && isRecord(capsule.payload) ? capsule.payload : null;
  const capsuleList = (key: string): string => {
    const value = capsulePayload?.[key];
    return Array.isArray(value) && value.length > 0 ? value.slice(0, 10).map(String).join(' | ') : '(none)';
  };
  return [
    `Goal: ${String(goal.goalKey ?? '')} (${String(goal.goalId ?? '')})`,
    `Goal status: ${String(goal.status ?? 'unknown')}`,
    `Goal revision: ${String(goal.revision ?? '')}; user intent revision: ${String(goal.userIntentRevision ?? '')}`,
    `Objective: ${String(goal.objective ?? '')}`,
    `Current phase: ${String(goal.currentPhase ?? '')}`,
    'Plan:',
    plan,
    'Acceptance criteria:',
    acceptance,
    'Blockers:',
    blockers,
    'Tracked goal tasks:',
    trackedTasks,
    `Next action: ${String(goal.nextAction ?? '')}`,
    ...(goal.terminalSummary === undefined ? [] : [
      `Terminal summary: ${String(goal.terminalSummary)}`,
      `Terminal evidence: ${evidenceList(goal.terminalEvidence)}`,
      `Terminal at: ${String(goal.terminalAt ?? '')}`,
    ]),
    checkpoint === null ? 'Latest checkpoint: none' : `Latest checkpoint: revision ${String(checkpoint.revision ?? '')} — ${String(checkpoint.summary ?? '')}`,
    ...(checkpoint === null ? [] : [
      `Checkpoint evidence: ${evidenceList(checkpoint.evidence)}`,
    ]),
    ...(resumeContext === null ? ['Checkpoint resume context: none recorded'] : [
      `Checkpoint changed files: ${resumeList('changedFiles')}`,
      `Checkpoint commands: ${resumeCommands}`,
      `Checkpoint decisions: ${resumeList('decisions')}`,
      `Checkpoint failed attempts: ${resumeList('failedAttempts')}`,
      `Checkpoint pending validation: ${resumeList('pendingValidation')}`,
      `Checkpoint resume prerequisites: ${resumeList('resumePrerequisites')}`,
      `Checkpoint state facts: ${evidenceList(resumeContext.stateFacts)}`,
      `Checkpoint artifacts: ${evidenceList(resumeContext.artifacts)}`,
    ]),
    capsule === null ? 'Context capsule: none published' : `Context capsule: ${String(capsule.id ?? '')} (goal rev ${String(capsule.sourceGoalRevision ?? '')}, intent rev ${String(capsule.sourceUserIntentRevision ?? '')})`,
    ...(capsulePayload === null ? [] : [
      `Capsule user steering: ${capsuleList('userSteering')}`,
      `Capsule completed work: ${capsuleList('completedWork')}`,
      `Capsule remaining work: ${capsuleList('remainingWork')}`,
      `Capsule decisions: ${capsuleList('decisions')}`,
      `Capsule validation: ${evidenceList(capsulePayload.validation, 10)}`,
      `Capsule artifacts: ${evidenceList(capsulePayload.artifacts, 10)}`,
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
    : input.backgroundTasks.map(formatTaskReceipt).join('\n');
  const changed = input.changedFiles.length === 0 ? '(clean)' : input.changedFiles.join(', ');
  return [
    'Recovery state from lnwjud durable task state.',
    'This is task state only, not persistent user or agent instructions.',
    input.goalExcerpt.length === 0 ? 'No Durable Goal recovery receipt was found; use the Git/workspace fallback below.' : input.goalExcerpt,
    '',
    `Legacy tracker (${input.trackerPath}):`,
    input.trackerAvailable ? (input.trackerExcerpt || '(tracker is empty)') : '(tracker unavailable; this is not fatal when durable goal/Git state exists)',
    '',
    `Current Git changes: ${changed}`,
    input.diffSummary.length === 0 ? 'Git diff summary: (no diff)' : `Git diff summary:\n${input.diffSummary}`,
    '',
    'Durable task receipts (status-only recovery; no task was relaunched):',
    tasks,
    '',
    'Resume rules:',
    '1. If a Durable Goal is present, read/reacquire or claim that same goal before any mutation; do not create a duplicate goal.',
    '2. Prefer the latest Context Capsule plus the latest durable goal revision over legacy tracker prose.',
    '3. If a task or goal is terminal, summarize the persisted receipt first; do not rerun completed work merely to recreate a missing assistant summary.',
    '4. Recover live durable jobs by task_id with shell status/logs/result; do not tight-poll or duplicate a live job.',
    '5. Inspect Git status/diff only as needed for the current phase and continue from the recorded next action.',
    '6. Do not redo completed phases unless verification proves a regression or the user explicitly requests a rerun.',
    '7. Do not persist this recovery state as USER_INSTRUCTIONS or generic handoff history.',
    '8. Never use browser/DOM automation to create, type into, switch, or resume ChatGPT conversations; use supported host-native turns/chats only.',
  ].join('\n');
}

function formatTaskReceipt(task: Record<string, unknown>): string {
  const exit = task.exit_code === undefined ? '' : ` exit=${String(task.exit_code)}`;
  const finished = task.finished_at === undefined ? '' : ` finished=${String(task.finished_at)}`;
  const details = [
    typeof task.error === 'string' ? `error: ${task.error}` : '',
    typeof task.stdout_tail === 'string' ? `stdout tail:\n${task.stdout_tail}` : '',
    typeof task.stderr_tail === 'string' ? `stderr tail:\n${task.stderr_tail}` : '',
  ].filter((value) => value.length > 0);
  return [`- ${String(task.task_id)} (${String(task.state ?? 'unknown')}${exit}${finished})`, ...details.map((value) => `  ${value}`)].join('\n');
}

function buildRecoveryReceipt(
  goal: Record<string, unknown> | null,
  backgroundTasks: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const status = typeof goal?.status === 'string' ? goal.status : undefined;
  let mode = 'report_terminal_goal';
  if (status === 'active') mode = 'resume_active_goal';
  else if (status === undefined) mode = 'workspace_fallback';
  return {
    mode,
    rerun_completed_work: false,
    ...(goal === null ? {} : {
      goal_id: goal.goalId,
      goal_key: goal.goalKey,
      goal_status: goal.status,
      goal_revision: goal.revision,
      next_action: goal.nextAction,
      ...(goal.terminalSummary === undefined ? {} : { terminal_summary: goal.terminalSummary }),
      ...(goal.terminalEvidence === undefined ? {} : { terminal_evidence: goal.terminalEvidence }),
      ...(goal.terminalAt === undefined ? {} : { terminal_at: goal.terminalAt }),
    }),
    task_receipts: backgroundTasks,
  };
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
