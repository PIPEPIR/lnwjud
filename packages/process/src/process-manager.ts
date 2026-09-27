import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { PathExecutableResolver, type ExecutableResolver } from './executable-resolver.js';
import { LogRingBuffer } from './ring-buffer.js';
import { createProcessTreeTerminator, type ProcessTreeTerminator } from './process-tree.js';
import { createSpawnInvocationFactory, type SpawnInvocationFactory } from './spawn-invocation.js';
import type { LogQuery, ManagedProcess, ManagedProcessStart, ManagedProcessState, ProcessLogResult } from './process-types.js';

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const START_CANCELLATION_RETRY_MS = 250;
const SENSITIVE_OUTPUT_MARKERS = [
  'api_key', 'api-key', 'apikey', 'access_token', 'access-token', 'accesstoken',
  'refresh_token', 'refresh-token', 'refreshtoken', 'password', 'secret', 'bearer',
];

export const DEFAULT_MAX_ACTIVE_MANAGED_PROCESSES = 24;
export const DEFAULT_MAX_RETAINED_TERMINAL_PROCESSES = 32;
export const MAX_RETAINED_TERMINAL_PROCESS_LOG_BYTES = 256 * 1024;

interface ManagedRecord {
  readonly processId: string;
  readonly child: ChildProcess;
  readonly spec: ManagedProcessStart;
  readonly startedAt: string;
  readonly logs: LogRingBuffer;
  readonly redactionValues: string[];
  readonly redactionMatchers: ProcessOutputRedactionMatcher[];
  readonly pendingOutput: { stdout: string; stderr: string };
  onTerminal?: (process: ManagedProcess) => void;
  state: ManagedProcessState;
  finishedAt?: string;
  exitCode?: number;
  errorMessage?: string;
  timer?: ReturnType<typeof setTimeout>;
  stopRequested?: 'stopped' | 'timed_out';
  terminationAttempt?: Promise<boolean>;
  terminationTarget?: 'stopped' | 'timed_out';
  terminationVerified?: Promise<void>;
  resolveTerminationVerified?: () => void;
  terminalNotified?: boolean;
}

interface ProcessOutputRedactionMatcher {
  readonly value: string;
  readonly prefixTable: Uint32Array;
}

export class ProcessManager {
  private readonly records = new Map<string, ManagedRecord>();

  public constructor(
    private readonly terminator: ProcessTreeTerminator = createProcessTreeTerminator(),
    private readonly executableResolver: ExecutableResolver = new PathExecutableResolver(),
    private readonly maxActiveProcesses: number = DEFAULT_MAX_ACTIVE_MANAGED_PROCESSES,
    private readonly invocationFactory: SpawnInvocationFactory = createSpawnInvocationFactory(),
  ) {}

  public async start(
    spec: ManagedProcessStart,
    signal?: AbortSignal,
    onCreated?: (process: ManagedProcess) => void,
    onTerminal?: (process: ManagedProcess) => void,
  ): Promise<Result<ManagedProcess>> {
    const activeProcesses = this.activeProcessCount();
    if (activeProcesses >= this.maxActiveProcesses) {
      return err(appError('CONFLICT', `Too many managed processes are already active (${activeProcesses}/${this.maxActiveProcesses}); wait for existing work or stop a process before starting another.`, true));
    }
    const validation = this.validateSpec(spec);
    if (!validation.ok) return validation;
    if (isAborted(signal)) return cancelledStart();
    const resolvedExecutable = await this.executableResolver.resolve(spec.executable);
    if (isAborted(signal)) return cancelledStart();
    if (!resolvedExecutable.ok) return resolvedExecutable;
    const invocation = this.invocationFactory.create(resolvedExecutable.value, spec.args);
    if (!invocation.ok) return invocation;
    if (isAborted(signal)) return cancelledStart();
    const processId = randomUUID();
    const redactionValues = (spec.redactOutputValues ?? []).filter((value) => value.length > 0);
    const redactionMatchers = redactionValues.map(createProcessOutputRedactionMatcher);
    const safeSpec: ManagedProcessStart = redactionValues.length === 0 ? spec : {
      executable: spec.executable,
      args: spec.args.map((argument) => redactionValues.includes(argument) ? '[REDACTED]' : argument),
      cwd: spec.cwd,
      ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
      ...(spec.stdin === undefined ? {} : { stdin: spec.stdin }),
    };
    const child = spawn(invocation.value.executable, [...invocation.value.args], {
      cwd: spec.cwd,
      env: createSafeEnvironment(process.env),
      shell: false,
      stdio: [spec.stdin === 'closed' ? 'pipe' : (spec.stdin ?? 'pipe'), 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
      ...(invocation.value.windowsVerbatimArguments === undefined ? {} : { windowsVerbatimArguments: invocation.value.windowsVerbatimArguments }),
    });
    const record: ManagedRecord = {
      processId,
      child,
      spec: safeSpec,
      startedAt: new Date().toISOString(),
      logs: new LogRingBuffer(),
      redactionValues,
      redactionMatchers,
      pendingOutput: { stdout: '', stderr: '' },
      ...(onTerminal === undefined ? {} : { onTerminal }),
      state: 'starting',
    };
    this.records.set(processId, record);
    onCreated?.(this.snapshot(record));
    child.stdout?.on('data', (chunk: Buffer) => this.captureOutput(record, 'stdout', chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => this.captureOutput(record, 'stderr', chunk.toString('utf8')));
    child.once('error', (error: Error & { code?: string }) => this.handleError(record, error));
    child.once('close', (exitCode: number | null) => this.handleClose(record, exitCode));
    if (spec.stdin === 'closed') child.stdin?.end();

    return new Promise((resolve) => {
      let settled = false;
      let cancellationRequested = false;
      let cancellationInProgress = false;
      const settle = (result: Result<ManagedProcess>): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        if (settled) return;
        cancellationRequested = true;
        if (cancellationInProgress) return;
        const pid = record.child.pid;
        if (pid === undefined) return;
        cancellationInProgress = true;
        void (async (): Promise<void> => {
          let verified = false;
          while (!verified) {
            verified = await this.tryTerminate(record, 'stopped');
            if (!verified) {
              if (!isChildLive(record.child)) await this.waitForVerifiedTermination(record);
              await delay(START_CANCELLATION_RETRY_MS);
            }
          }
          settle(cancelledStart());
        })();
      };
      child.once('spawn', () => {
        if (cancellationRequested || isAborted(signal)) {
          onAbort();
          return;
        }
        if (record.state === 'starting') record.state = 'running';
        record.timer = setTimeout(() => { void this.timeout(record); }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        settle(ok(this.snapshot(record)));
      });
      child.once('error', (error: Error & { code?: string }) => {
        if (cancellationRequested) {
          settle(cancelledStart());
          return;
        }
        settle(err(error.code === 'ENOENT' ? appError('EXECUTABLE_NOT_FOUND', 'Executable was not found') : appError('INTERNAL_ERROR', 'Process could not start')));
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (isAborted(signal)) onAbort();
    });
  }

  public status(processId: string): Result<ManagedProcess> {
    const record = this.records.get(processId);
    return record === undefined ? err(appError('PROCESS_NOT_FOUND', 'Process was not found')) : ok(this.snapshot(record));
  }

  public list(): readonly ManagedProcess[] {
    return [...this.records.values()].map((record) => this.snapshot(record));
  }

  public logs(processId: string, query: LogQuery): Result<ProcessLogResult> {
    const record = this.records.get(processId);
    if (record === undefined) return err(appError('PROCESS_NOT_FOUND', 'Process was not found'));
    if (query.tailLines !== undefined && (!Number.isInteger(query.tailLines) || query.tailLines < 1 || query.tailLines > 10000)) {
      return err(appError('INVALID_INPUT', 'Log tail limit is invalid'));
    }
    if (query.sinceSequence !== undefined && (!Number.isInteger(query.sinceSequence) || query.sinceSequence < 0)) {
      return err(appError('INVALID_INPUT', 'Log sequence cursor is invalid'));
    }
    return ok(record.logs.read(query));
  }

  public async stop(processId: string, autoRetry = false): Promise<Result<void>> {
    const record = this.records.get(processId);
    if (record === undefined) return err(appError('PROCESS_NOT_FOUND', 'Process was not found'));
    if (record.state !== 'termination_unverified' && isTerminal(record.state)) return ok(undefined);
    const targetState = record.terminationTarget ?? 'stopped';
    let verified = await this.tryTerminate(record, targetState);
    while (!verified && autoRetry && isChildLive(record.child)) {
      await delay(START_CANCELLATION_RETRY_MS);
      verified = await this.tryTerminate(record, targetState);
    }
    if (!verified) await this.waitForVerifiedTermination(record);
    return ok(undefined);
  }

  private activeProcessCount(): number {
    return [...this.records.values()].filter((record) => (
      record.state === 'starting' || record.state === 'running' || record.state === 'termination_unverified'
    )).length;
  }

  private validateSpec(spec: ManagedProcessStart): Result<void> {
    if (typeof spec.executable !== 'string' || spec.executable.trim().length === 0 || !Array.isArray(spec.args) || !spec.args.every((arg) => typeof arg === 'string')) {
      return err(appError('INVALID_INPUT', 'Executable and args are required'));
    }
    if (typeof spec.cwd !== 'string' || !path.isAbsolute(spec.cwd)) {
      return err(appError('INVALID_INPUT', 'Process cwd must be an absolute path'));
    }
    const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      return err(appError('INVALID_INPUT', 'Process timeout is invalid'));
    }
    return ok(undefined);
  }

  private handleError(record: ManagedRecord, error: Error & { code?: string }): void {
    if (error.code !== 'ENOENT') record.exitCode = -1;
    if (record.stopRequested === undefined && !isTerminal(record.state)) this.finish(record, 'failed');
  }

  private handleClose(record: ManagedRecord, exitCode: number | null): void {
    if (record.exitCode === undefined && exitCode !== null) record.exitCode = exitCode;
    this.flushPendingOutput(record);
    if (record.stopRequested === undefined && !isTerminal(record.state)) this.finish(record, 'exited');
    record.redactionValues.length = 0;
    record.redactionMatchers.length = 0;
  }

  private captureOutput(record: ManagedRecord, stream: 'stdout' | 'stderr', value: string): void {
    if (record.redactionValues.length === 0) {
      record.logs.append(stream, value);
      return;
    }
    const combined = record.pendingOutput[stream] + value;
    let heldCharacters = 0;
    for (const matcher of record.redactionMatchers) {
      heldCharacters = Math.max(heldCharacters, longestSensitivePrefixSuffix(combined, matcher));
    }
    heldCharacters = Math.max(heldCharacters, longestSensitiveOutputSuffix(combined));
    const safeEnd = combined.length - heldCharacters;
    if (safeEnd > 0) record.logs.append(stream, redactProcessOutput(combined.slice(0, safeEnd), record.redactionValues));
    record.pendingOutput[stream] = combined.slice(safeEnd);
  }

  private flushPendingOutput(record: ManagedRecord): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const value = record.pendingOutput[stream];
      if (value.length > 0) {
        const heldPromptCharacters = record.redactionMatchers.reduce(
          (held, matcher) => Math.max(held, longestSensitivePrefixSuffix(value, matcher)),
          0,
        );
        const output = heldPromptCharacters === 0
          ? value
          : `${value.slice(0, -heldPromptCharacters)}[REDACTED]`;
        record.logs.append(stream, redactProcessOutput(output, record.redactionValues));
      }
      record.pendingOutput[stream] = '';
    }
  }

  private async timeout(record: ManagedRecord): Promise<void> {
    if (record.state !== 'running' || record.stopRequested !== undefined) return;
    await this.tryTerminate(record, 'timed_out');
  }

  private async tryTerminate(record: ManagedRecord, targetState: 'stopped' | 'timed_out'): Promise<boolean> {
    if (isVerifiedTerminal(record.state)) return true;
    if (record.terminationAttempt !== undefined) return record.terminationAttempt;
    const attempt = this.performTermination(record, targetState);
    record.terminationAttempt = attempt;
    try {
      return await attempt;
    } finally {
      if (record.terminationAttempt === attempt) delete record.terminationAttempt;
    }
  }

  private async performTermination(record: ManagedRecord, targetState: 'stopped' | 'timed_out'): Promise<boolean> {
    record.terminationTarget = targetState;
    record.stopRequested = targetState;
    if (record.timer !== undefined) clearTimeout(record.timer);
    const pid = record.child.pid;
    if (pid === undefined) {
      delete record.stopRequested;
      this.markTerminationUnverified(record, targetState === 'timed_out'
        ? 'Timed-out process termination could not be verified'
        : 'Process termination could not be verified');
      return false;
    }
    try {
      await this.terminator.stop(record.child, pid);
      this.finish(record, targetState);
      return true;
    } catch {
      delete record.stopRequested;
      this.markTerminationUnverified(record, targetState === 'timed_out'
        ? 'Timed-out process termination could not be verified'
        : 'Process termination could not be verified');
      return false;
    }
  }

  private finish(record: ManagedRecord, state: ManagedProcessState): void {
    record.state = state;
    delete record.stopRequested;
    delete record.errorMessage;
    delete record.terminationTarget;
    record.finishedAt = new Date().toISOString();
    if (record.timer !== undefined) clearTimeout(record.timer);
    record.resolveTerminationVerified?.();
    delete record.resolveTerminationVerified;
    delete record.terminationVerified;
    record.logs.compact(MAX_RETAINED_TERMINAL_PROCESS_LOG_BYTES);
    this.records.delete(record.processId);
    this.records.set(record.processId, record);
    this.pruneTerminalRecords();
    if (!record.terminalNotified) {
      record.terminalNotified = true;
      try {
        record.onTerminal?.(this.snapshot(record));
      } catch {
        // A host observer must not interrupt process cleanup or state updates.
      }
    }
    delete record.onTerminal;
  }

  private pruneTerminalRecords(): void {
    let terminalCount = [...this.records.values()].filter((record) => isVerifiedTerminal(record.state)).length;
    if (terminalCount <= DEFAULT_MAX_RETAINED_TERMINAL_PROCESSES) return;
    for (const [processId, record] of this.records) {
      if (!isVerifiedTerminal(record.state)) continue;
      this.records.delete(processId);
      terminalCount -= 1;
      if (terminalCount <= DEFAULT_MAX_RETAINED_TERMINAL_PROCESSES) return;
    }
  }

  private markTerminationUnverified(record: ManagedRecord, errorMessage: string): void {
    record.state = 'termination_unverified';
    record.errorMessage = errorMessage;
    delete record.finishedAt;
    if (record.timer !== undefined) clearTimeout(record.timer);
    if (record.terminationVerified === undefined) {
      record.terminationVerified = new Promise<void>((resolve) => { record.resolveTerminationVerified = resolve; });
    }
  }

  private waitForVerifiedTermination(record: ManagedRecord): Promise<void> {
    if (isVerifiedTerminal(record.state)) return Promise.resolve();
    if (record.terminationVerified === undefined) {
      record.terminationVerified = new Promise<void>((resolve) => { record.resolveTerminationVerified = resolve; });
    }
    return record.terminationVerified;
  }

  private snapshot(record: ManagedRecord): ManagedProcess {
    return {
      processId: record.processId,
      executable: record.spec.executable,
      args: [...record.spec.args],
      cwd: record.spec.cwd,
      state: record.state,
      startedAt: record.startedAt,
      ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
      ...(record.errorMessage === undefined ? {} : { error: record.errorMessage }),
    };
  }
}

function isTerminal(state: ManagedProcessState): boolean {
  return state === 'exited' || state === 'failed' || state === 'stopped' || state === 'timed_out' || state === 'termination_unverified';
}

function isVerifiedTerminal(state: ManagedProcessState): boolean {
  return state === 'exited' || state === 'failed' || state === 'stopped' || state === 'timed_out';
}

function cancelledStart(): Result<never> {
  return err(appError('PROCESS_TIMEOUT', 'Process start was cancelled before launch completed', true));
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function redactProcessOutput(value: string, sensitiveValues: readonly string[]): string {
  let redacted = value;
  for (const sensitiveValue of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(sensitiveValue, '[REDACTED]');
  }
  return redacted
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\b["']?\s*[:=]\s*["']?)[^\s"'}]+/gi, '$1[REDACTED]');
}

function createProcessOutputRedactionMatcher(value: string): ProcessOutputRedactionMatcher {
  const prefixTable = new Uint32Array(value.length);
  for (let index = 1, matched = 0; index < value.length; index += 1) {
    while (matched > 0 && value[index] !== value[matched]) matched = prefixTable[matched - 1]!;
    if (value[index] === value[matched]) matched += 1;
    prefixTable[index] = matched;
  }
  return { value, prefixTable };
}

function longestSensitivePrefixSuffix(text: string, matcher: ProcessOutputRedactionMatcher): number {
  let matched = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    while (matched > 0 && character !== matcher.value[matched]) matched = matcher.prefixTable[matched - 1]!;
    if (character === matcher.value[matched]) matched += 1;
    if (matched === matcher.value.length) matched = matcher.prefixTable[matched - 1]!;
  }
  return matched;
}

function longestSensitiveOutputSuffix(text: string): number {
  const normalized = text.toLowerCase();
  let heldCharacters = 0;
  for (const marker of SENSITIVE_OUTPUT_MARKERS) {
    const limit = Math.min(marker.length, text.length);
    for (let length = limit; length > heldCharacters; length -= 1) {
      if (normalized.endsWith(marker.slice(0, length))) {
        heldCharacters = length;
        break;
      }
    }
  }
  const secretField = /(?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\b["']?\s*[:=]\s*["']?)[^\s"'}]*$/i.exec(text);
  const bearerValue = /\bBearer\s+[A-Za-z0-9._~+/-]*=?$/i.exec(text);
  if (secretField !== null) heldCharacters = Math.max(heldCharacters, text.length - secretField.index);
  if (bearerValue !== null) heldCharacters = Math.max(heldCharacters, text.length - bearerValue.index);
  return heldCharacters;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isChildLive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}


function createSafeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'HOME', 'LANG', 'LC_ALL', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)',
    // Preserve non-secret POSIX desktop-session handles for UI processes.
    'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'DBUS_SESSION_BUS_ADDRESS',
    'XDG_CURRENT_DESKTOP', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'PULSE_SERVER', 'PIPEWIRE_REMOTE', 'AT_SPI_BUS_ADDRESS',
    'GDK_BACKEND', 'QT_QPA_PLATFORM',
  ].map((key) => process.platform === 'win32' ? key.toLowerCase() : key));
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => {
    const normalizedKey = process.platform === 'win32' ? key.toLowerCase() : key;
    return allowed.has(normalizedKey) && value !== undefined;
  }));
}
