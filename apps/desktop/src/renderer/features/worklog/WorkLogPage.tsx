import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { workspaceScopeMatches, type CodexTaskLogsResult, type CodexTaskMonitorItem, type DashboardSnapshot, type UiLocale, type WorkLogEntry, type WorkspaceSummary } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';
import { WorkLogPanel, type LogScopeSelection, type WorkLogFilter } from '../worklog/WorkLogPanel.js';

interface WorkLogPageProps {
  readonly locale: UiLocale;
  readonly dashboard: DashboardSnapshot;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly onClearWorkLog: (scope: LogScopeSelection) => Promise<void>;
  readonly onExportWorkLog: (rowIds: readonly string[]) => Promise<void>;
  readonly onLoadSessionHistory: (scope: LogScopeSelection) => Promise<readonly WorkLogEntry[]>;
}

export function WorkLogPage(props: WorkLogPageProps): ReactElement {
  const t = createTranslator(props.locale);
  const [filter, setFilter] = useState<WorkLogFilter>('all');
  const [historicalEntries, setHistoricalEntries] = useState<readonly WorkLogEntry[]>([]);
  const [codexTasks, setCodexTasks] = useState<readonly CodexTaskMonitorItem[]>([]);
  const [codexTaskLogs, setCodexTaskLogs] = useState<Readonly<Record<string, CodexTaskLogsResult>>>({});
  const [codexTaskLogErrors, setCodexTaskLogErrors] = useState<ReadonlySet<string>>(new Set());
  const [codexTaskStoppingIds, setCodexTaskStoppingIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedCodexTaskIds, setExpandedCodexTaskIds] = useState<ReadonlySet<string>>(new Set());
  const sessionLoadGeneration = useRef(0);
  useEffect(() => {
    if (filter !== 'codex') return undefined;
    let active = true;
    let pending = false;
    const refresh = async (): Promise<void> => {
      if (pending) return;
      pending = true;
      try {
        const tasks = await window.lnwjud.listCodexTasks();
        if (!active) return;
        setCodexTasks(tasks);
        const expanded = [...expandedCodexTaskIds].filter((id) => tasks.some((task) => task.codexTaskId === id));
        const updates = await Promise.all(expanded.map(async (codexTaskId): Promise<{ readonly codexTaskId: string; readonly logs: CodexTaskLogsResult | null }> => {
          try {
            return { codexTaskId, logs: await window.lnwjud.readCodexTaskLogs({ codexTaskId, tailLines: 100 }) };
          } catch {
            return { codexTaskId, logs: null };
          }
        }));
        if (!active) return;
        setCodexTaskLogs((current) => {
          const next = { ...current };
          for (const update of updates) if (update.logs !== null) next[update.codexTaskId] = update.logs;
          return next;
        });
        setCodexTaskLogErrors((current) => {
          const next = new Set(current);
          for (const update of updates) {
            if (update.logs === null) next.add(update.codexTaskId);
            else next.delete(update.codexTaskId);
          }
          return next;
        });
      } catch {
        // A transient IPC failure is retried on the next active Codex refresh.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 1_000);
    return (): void => {
      active = false;
      window.clearInterval(interval);
    };
  }, [filter, expandedCodexTaskIds]);
  const resolveTargetDetail = useCallback(async (detailRef: string) => (await window.lnwjud.resolveActivityTargetDetail({ detailRef })).detail, []);
  const searchTargetDetails = useCallback(async (
    query: string,
    candidates: readonly { readonly id: string; readonly detailRef: string | null }[],
  ) => (await window.lnwjud.searchActivityTargetDetails({ query, candidates })).matchingIds, []);
  const entries = [...new Map([...props.dashboard.workLog, ...historicalEntries].map((entry) => [entry.id, entry])).values()];
  const loadSession = async (scope: LogScopeSelection): Promise<void> => {
    const generation = ++sessionLoadGeneration.current;
    if (scope.sessionId === null) {
      setHistoricalEntries([]);
      return;
    }
    const entries = await props.onLoadSessionHistory(scope);
    if (generation === sessionLoadGeneration.current) setHistoricalEntries(entries);
  };
  const clearWorkLog = async (scope: LogScopeSelection): Promise<void> => {
    await props.onClearWorkLog(scope);
    setHistoricalEntries((entries) => retainedHistoricalEntriesAfterClear(entries, scope, props.workspaces));
  };
  const toggleCodexTaskDetails = (codexTaskId: string, expanded: boolean): void => {
    setExpandedCodexTaskIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(codexTaskId);
      else next.delete(codexTaskId);
      return next;
    });
  };
  const stopCodexTask = async (codexTaskId: string): Promise<void> => {
    setCodexTaskStoppingIds((current) => new Set(current).add(codexTaskId));
    try {
      await window.lnwjud.stopCodexTask({ codexTaskId });
    } catch {
      // The next host task refresh remains authoritative for process state.
    } finally {
      setCodexTaskStoppingIds((current) => {
        const next = new Set(current);
        next.delete(codexTaskId);
        return next;
      });
    }
  };
  return (
    <div className="page-content viewport-list-page worklog-page">
      <p className="page-subtitle">{t('workLog.subtitle')}</p>
      <WorkLogPanel
        locale={props.locale}
        title={t('workLog.title')}
        emptyLabel={t('workLog.empty')}
        filterAllLabel={t('workLog.filterAll')}
        filterErrorLabel={t('workLog.filterError')}
        filterCodexLabel={t('workLog.filterCodex')}
        clearSessionLabel={t('scope.clearSession')}
        clearWorkspaceLabel={t('scope.clearWorkspace')}
        clearAllLabel={t('scope.clearAll')}
        filter={filter}
        onFilterChange={setFilter}
        onClear={clearWorkLog}
        exportLabel={t('live.export')}
        onExport={props.onExportWorkLog}
        onResolveTargetDetail={resolveTargetDetail}
        onSearchTargetDetails={searchTargetDetails}
        entries={entries}
        inFlight={props.dashboard.inFlight}
        codexTasks={codexTasks}
        codexTaskLogs={codexTaskLogs}
        codexTaskLogErrors={codexTaskLogErrors}
        codexTaskStoppingIds={codexTaskStoppingIds}
        onCodexTaskExpanded={toggleCodexTaskDetails}
        onStopCodexTask={stopCodexTask}
        codexLabels={{
          task: t('workLog.codexTask'),
          statuses: {
            starting: t('workLog.codexStarting'), running: t('workLog.codexRunning'), exited: t('workLog.codexExited'),
            failed: t('workLog.codexFailed'), stopped: t('workLog.codexStopped'), timed_out: t('workLog.codexTimedOut'),
            termination_unverified: t('workLog.codexUnverified'),
          },
          elapsed: t('workLog.codexElapsed'), finished: t('workLog.codexFinished'), output: t('workLog.codexOutput'),
          noOutput: t('workLog.codexNoOutput'), truncated: t('workLog.codexTruncated'), stop: t('workLog.codexStop'),
          stopping: t('workLog.codexStopping'), model: t('workLog.codexModel'), reasoning: t('workLog.codexReasoning'),
          logError: t('workLog.codexLogError'), exitCode: t('workLog.codexExitCode'),
        }}
        sessions={props.dashboard.workLogSessions ?? []}
        onSessionChange={loadSession}
        workspaces={props.workspaces}
        defaultWorkspaceId={props.dashboard.selectedWorkspace?.id ?? null}
        workspaceLabel={t('scope.workspace')}
        sessionLabel={t('scope.session')}
        scopeAllLabel={t('scope.all')}
        searchPlaceholder={t('workLog.searchPlaceholder')}
        copyLabel={t('mcp.copy')}
        copiedLabel={t('mcp.copied')}
        showMoreLabel={t('logDetail.showMore')}
        showLessLabel={t('logDetail.showLess')}
        detailHeadingLabel={t('logDetail.heading')}
        detailLoadingLabel={t('logDetail.loading')}
        detailErrorLabel={t('logDetail.error')}
        detailEmptyLabel={t('logDetail.empty')}
        legacyIncompleteLabel={t('logDetail.legacyIncomplete')}
      />
    </div>
  );
}

export function retainedHistoricalEntriesAfterClear(
  entries: readonly WorkLogEntry[],
  scope: LogScopeSelection,
  workspaces: readonly WorkspaceSummary[] = [],
): readonly WorkLogEntry[] {
  if (scope.sessionId !== null) return entries.filter((entry) => entry.sessionId !== scope.sessionId);
  const workspaceId = scope.workspaceId;
  if (workspaceId !== null) return entries.filter((entry) => !workspaceScopeMatches(workspaces, entry.workspaceId, workspaceId));
  return [];
}
