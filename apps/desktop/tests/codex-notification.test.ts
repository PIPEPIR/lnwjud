import { describe, expect, it, vi } from 'vitest';
import type { CodexTaskTerminalEvent } from '@lnwjud/application';
import { notifyCodexTaskFinished } from '../src/main/codex-notification.js';

const event: CodexTaskTerminalEvent = {
  codexTaskId: 'codex-1', workspaceId: 'workspace-1', state: 'exited',
  startedAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T00:00:05.000Z', exitCode: 0,
};

describe('Codex completion notifications', () => {
  it.each([
    ['success', event, 'Codex finished'],
    ['unknown exit status', { ...event, exitCode: undefined }, 'Codex failed'],
    ['failure', { ...event, state: 'failed', error: 'private error detail' }, 'Codex failed'],
    ['stopped', { ...event, state: 'stopped' }, 'Codex stopped'],
    ['timed out', { ...event, state: 'timed_out' }, 'Codex timed out'],
  ] as const)('uses the localized terminal status for %s', async (_label, task, expectedTitle) => {
    const showNotification = vi.fn();
    await notifyCodexTaskFinished(task, 'en', async () => 'Project One', showNotification);

    expect(showNotification).toHaveBeenCalledWith(expectedTitle, expect.stringContaining('Project One'));
    expect(JSON.stringify(showNotification.mock.calls)).not.toContain('private error detail');
  });

  it('uses Thai text and contains native notification failures', async () => {
    const showNotification = vi.fn(() => Promise.reject(new Error('native notifications unavailable')));
    await expect(notifyCodexTaskFinished(event, 'th', async () => null, showNotification)).resolves.toBeUndefined();
    expect(showNotification).toHaveBeenCalledWith('Codex เสร็จแล้ว', expect.stringContaining('codex-1'));
  });
});
