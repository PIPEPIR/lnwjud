import type { CodexTaskTerminalEvent } from '@lnwjud/application';
import type { UiLocale } from '@lnwjud/ipc-contracts';

export async function notifyCodexTaskFinished(
  event: CodexTaskTerminalEvent,
  locale: UiLocale,
  getWorkspaceName: () => Promise<string | null>,
  showNotification?: (title: string, body: string) => Promise<void> | void,
): Promise<void> {
  if (showNotification === undefined) return;
  let workspaceName: string | null = null;
  try {
    workspaceName = await getWorkspaceName();
  } catch {
    // A missing workspace label does not prevent the task notification.
  }

  const status = event.state === 'stopped'
    ? 'stopped'
    : event.state === 'timed_out'
      ? 'timed_out'
      : event.state === 'exited' && event.exitCode === 0
        ? 'success'
        : 'failure';
  const labels = locale === 'th'
    ? { success: 'Codex เสร็จแล้ว', failure: 'Codex ล้มเหลว', stopped: 'Codex ถูกหยุด', timed_out: 'Codex หมดเวลา', task: 'งาน' }
    : { success: 'Codex finished', failure: 'Codex failed', stopped: 'Codex stopped', timed_out: 'Codex timed out', task: 'Task' };
  const workspace = workspaceName?.trim() || event.workspaceId;
  try {
    await showNotification(labels[status], `${labels.task} ${event.codexTaskId} · ${workspace}`);
  } catch {
    // Native notification failures must not affect the Codex process lifecycle.
  }
}
