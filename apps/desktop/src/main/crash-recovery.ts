import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactDiagnosticText } from '@lnwjud/application';

const MAX_CRASH_LOG_BYTES = 512 * 1024;
const RETAINED_CRASH_EVENTS = 128;
const MAX_EVENT_TEXT = 1_000;
const RECOVERY_WINDOW_MS = 5 * 60_000;
const MAX_RECOVERIES_PER_WINDOW = 3;

export type CrashEventType = 'main-uncaught-exception' | 'renderer-gone' | 'child-process-gone' | 'desktop-lifecycle';

export interface CrashEventInput {
  readonly type: CrashEventType;
  readonly processType?: string;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly error?: unknown;
}

export interface CrashEventRecord {
  readonly schemaVersion: 1;
  readonly timestamp: string;
  readonly appVersion: string;
  readonly type: CrashEventType;
  readonly processType?: string;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly errorName?: string;
  readonly errorMessage?: string;
}

export class CrashDiagnosticsRecorder {
  public readonly filePath: string;

  public constructor(dataPath: string, private readonly appVersion: string) {
    this.filePath = path.join(path.resolve(dataPath), 'crashes', 'crash-events.ndjson');
  }

  public record(input: CrashEventInput): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const record = createCrashEventRecord(this.appVersion, input);
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
      this.compactIfNeeded();
    } catch (error: unknown) {
      console.error(`Crash diagnostics write failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private compactIfNeeded(): void {
    if (statSync(this.filePath).size <= MAX_CRASH_LOG_BYTES) return;
    const lines = readFileSync(this.filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    const retained = lines.slice(-RETAINED_CRASH_EVENTS);
    writeFileSync(this.filePath, retained.length === 0 ? '' : `${retained.join('\n')}\n`, 'utf8');
  }
}

export class RendererRecoveryPolicy {
  private readonly attempts: number[] = [];

  public shouldRecover(reason: string, now: number = Date.now()): boolean {
    if (reason === 'clean-exit') return false;
    while (this.attempts.length > 0 && now - (this.attempts[0] ?? now) > RECOVERY_WINDOW_MS) this.attempts.shift();
    if (this.attempts.length >= MAX_RECOVERIES_PER_WINDOW) return false;
    this.attempts.push(now);
    return true;
  }
}

/** Prevents window-all-closed from terminating the desktop while a crashed renderer is being replaced. */
export class RendererRecoveryBarrier {
  private pending = 0;

  public begin(): () => void {
    this.pending += 1;
    let completed = false;
    return (): void => {
      if (completed) return;
      completed = true;
      this.pending = Math.max(0, this.pending - 1);
    };
  }

  public isPending(): boolean {
    return this.pending > 0;
  }

  public shouldQuitWhenWindowsClosed(platform: NodeJS.Platform): boolean {
    return platform !== 'darwin' && !this.isPending();
  }
}

export function createCrashEventRecord(appVersion: string, input: CrashEventInput, timestamp: string = new Date().toISOString()): CrashEventRecord {
  const error = input.error instanceof Error
    ? { errorName: sanitizeCrashText(input.error.name), errorMessage: sanitizeCrashText(input.error.message) }
    : input.error === undefined
      ? {}
      : { errorName: 'UnknownError', errorMessage: sanitizeCrashText(String(input.error)) };
  return {
    schemaVersion: 1,
    timestamp,
    appVersion,
    type: input.type,
    ...(input.processType === undefined ? {} : { processType: sanitizeCrashText(input.processType) }),
    ...(input.reason === undefined ? {} : { reason: sanitizeCrashText(input.reason) }),
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...error,
  };
}

function sanitizeCrashText(value: string): string {
  let sanitized = redactDiagnosticText(value);
  const home = os.homedir();
  if (home.length > 2) sanitized = sanitized.replaceAll(home, '<USERPROFILE>');
  return sanitized.slice(0, MAX_EVENT_TEXT);
}
