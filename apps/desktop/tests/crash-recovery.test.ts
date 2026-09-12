import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CrashDiagnosticsRecorder, RendererRecoveryBarrier, RendererRecoveryPolicy, createCrashEventRecord } from '../src/main/crash-recovery.js';

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('crash recovery diagnostics', () => {
  it('redacts credentials and bounds crash text without persisting stacks', () => {
    const record = createCrashEventRecord('4.6.1', {
      type: 'main-uncaught-exception',
      error: new Error(`Authorization: Bearer secret-token PASSWORD=hunter2 ${'x'.repeat(2_000)}`),
    }, '2026-08-22T00:00:00.000Z');

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('stack');
    expect(record.errorMessage?.length).toBeLessThanOrEqual(1_000);
  });

  it('writes local NDJSON crash records', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-crash-'));
    temporaryRoots.push(root);
    const recorder = new CrashDiagnosticsRecorder(root, '4.6.1');
    recorder.record({ type: 'renderer-gone', processType: 'renderer', reason: 'crashed', exitCode: 1 });

    const content = await readFile(recorder.filePath, 'utf8');
    expect(content).toContain('"type":"renderer-gone"');
    expect(content).toContain('"reason":"crashed"');
  });

  it('rate-limits renderer recovery to avoid a crash loop', () => {
    const policy = new RendererRecoveryPolicy();
    expect(policy.shouldRecover('clean-exit', 1_000)).toBe(false);
    expect(policy.shouldRecover('crashed', 1_000)).toBe(true);
    expect(policy.shouldRecover('crashed', 2_000)).toBe(true);
    expect(policy.shouldRecover('oom', 3_000)).toBe(true);
    expect(policy.shouldRecover('crashed', 4_000)).toBe(false);
    expect(policy.shouldRecover('crashed', 5 * 60_000 + 5_000)).toBe(true);
  });

  it('keeps the desktop alive while a crashed renderer replacement is pending', () => {
    const barrier = new RendererRecoveryBarrier();
    expect(barrier.shouldQuitWhenWindowsClosed('win32')).toBe(true);
    expect(barrier.shouldQuitWhenWindowsClosed('darwin')).toBe(false);

    const complete = barrier.begin();
    expect(barrier.isPending()).toBe(true);
    expect(barrier.shouldQuitWhenWindowsClosed('win32')).toBe(false);
    complete();
    complete();

    expect(barrier.isPending()).toBe(false);
    expect(barrier.shouldQuitWhenWindowsClosed('win32')).toBe(true);
  });
});
