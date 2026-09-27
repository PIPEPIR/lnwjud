import { useEffect, useMemo, useReducer, useRef, useState, type ComponentProps, type ReactElement, type UIEvent } from 'react';
import { canonicalWorkspaceScopeId, workspaceScopeMatches, type ActivityTargetDetail, type CodexTaskLogsResult, type CodexTaskMonitorItem, type CodexTaskMonitorState, type InFlightWorkItem, type LogSessionSummary, type UiLocale, type WorkLogEntry, type WorkspaceSummary } from '@lnwjud/ipc-contracts';
import { formatDisplayTimestampItem } from '@lnwjud/shared/date-time-display';
import { copyTextToClipboard } from '../../clipboard.js';
import type { MessageKey } from '../../i18n/messages.js';
import { formatLogExportDateTime, formatLogUiTime } from '../../log-timestamp.js';
import { ExpandableTargetDetail } from '../logs/ExpandableTargetDetail.js';
import { activeDetailMatchIds, activeLogFeed, createDetailSearchState, normalizeDetailSearchQuery, reduceDetailSearchState, transitionLogFeedFreeze } from '../logs/detail-search-state.js';
import { collectSessionFilterOptions, collectWorkspaceFilterOptions, type ScopeFilterSample } from '../../scope-filter-options.js';

export type WorkLogFilter = 'all' | 'error' | 'codex';

export interface CodexWorkLogLabels {
  readonly task: string;
  readonly statuses: Readonly<Record<CodexTaskMonitorState, string>>;
  readonly elapsed: string;
  readonly finished: string;
  readonly output: string;
  readonly noOutput: string;
  readonly truncated: string;
  readonly stop: string;
  readonly stopping: string;
  readonly model: string;
  readonly reasoning: string;
  readonly logError: string;
  readonly exitCode: string;
}

export interface LogScopeSelection {
  readonly workspaceId: string | null;
  readonly sessionId: string | null;
}

type WorkLogRow =
  | { readonly kind: 'inflight'; readonly timestamp: string; readonly id: string; readonly item: InFlightWorkItem }
  | { readonly kind: 'entry'; readonly timestamp: string; readonly id: string; readonly item: WorkLogEntry };

interface WorkLogPanelProps {
  readonly locale?: UiLocale;
  readonly title: string;
  readonly emptyLabel: string;
  readonly filterAllLabel: string;
  readonly filterErrorLabel: string;
  readonly filterCodexLabel?: string;
  readonly clearSessionLabel: string;
  readonly clearWorkspaceLabel: string;
  readonly clearAllLabel: string;
  readonly filter: WorkLogFilter;
  readonly onFilterChange: (filter: WorkLogFilter) => void;
  readonly onClear: (scope: LogScopeSelection) => Promise<void>;
  readonly exportLabel?: string;
  readonly onExport?: (rowIds: readonly string[]) => Promise<void>;
  readonly onResolveTargetDetail?: (detailRef: string) => Promise<ActivityTargetDetail | null>;
  readonly onSearchTargetDetails?: (query: string, candidates: readonly { readonly id: string; readonly detailRef: string | null }[]) => Promise<readonly string[]>;
  readonly entries: readonly WorkLogEntry[];
  readonly inFlight: readonly InFlightWorkItem[];
  readonly sessions?: readonly LogSessionSummary[];
  readonly onSessionChange?: (scope: LogScopeSelection) => Promise<void>;
  readonly searchPlaceholder?: string;
  readonly copyLabel?: string;
  readonly copiedLabel?: string;
  readonly compact?: boolean;
  readonly workspaces?: readonly WorkspaceSummary[];
  readonly defaultWorkspaceId?: string | null;
  readonly codexTasks?: readonly CodexTaskMonitorItem[];
  readonly codexTaskLogs?: Readonly<Record<string, CodexTaskLogsResult>>;
  readonly codexTaskLogErrors?: ReadonlySet<string>;
  readonly codexTaskStoppingIds?: ReadonlySet<string>;
  readonly codexLabels?: CodexWorkLogLabels;
  readonly onCodexTaskExpanded?: (codexTaskId: string, expanded: boolean) => void;
  readonly onStopCodexTask?: (codexTaskId: string) => Promise<void>;
  readonly workspaceLabel?: string;
  readonly sessionLabel?: string;
  readonly scopeAllLabel?: string;
  readonly showMoreLabel?: string;
  readonly showLessLabel?: string;
  readonly detailHeadingLabel?: string;
  readonly detailLoadingLabel?: string;
  readonly detailErrorLabel?: string;
  readonly detailEmptyLabel?: string;
  readonly legacyIncompleteLabel?: string;
}


const PROGRESSIVE_PAGE_SIZE = 120;

export function WorkLogPanel(props: WorkLogPanelProps): ReactElement {
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyErrorId, setCopyErrorId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(props.defaultWorkspaceId ?? null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PROGRESSIVE_PAGE_SIZE);
  const [detailSearchState, dispatchDetailSearch] = useReducer(reduceDetailSearchState, undefined, createDetailSearchState);
  const detailSearchGeneration = useRef(0);
  const currentFeed = useMemo(
    () => ({ entries: props.entries, inFlight: props.inFlight, workspaces: props.workspaces, codexTasks: props.codexTasks ?? [] }),
    [props.entries, props.inFlight, props.workspaces, props.codexTasks],
  );
  const [feedFreeze, setFeedFreeze] = useState<typeof currentFeed | null>(null);
  const feed = activeLogFeed(feedFreeze, currentFeed);
  const scopeFilterSamples = useMemo<readonly ScopeFilterSample[]>(() => [
    ...feed.entries.map((entry) => ({ workspaceId: entry.workspaceId, sessionId: entry.sessionId, timestamp: entry.timestamp })),
    ...feed.inFlight.map((item) => ({ workspaceId: item.workspaceId, sessionId: item.sessionId, timestamp: item.startedAt })),
    ...(props.filter === 'codex' ? feed.codexTasks.map((item) => ({ workspaceId: item.workspaceId, sessionId: null, timestamp: item.finishedAt ?? item.startedAt })) : []),
    ...(props.sessions ?? []).map((session) => ({ workspaceId: session.workspaceId, sessionId: session.sessionId, timestamp: session.startedAt })),
  ], [feed, props.filter, props.sessions]);
  const workspaceOptions = useMemo(() => collectWorkspaceFilterOptions(scopeFilterSamples, feed.workspaces), [scopeFilterSamples, feed.workspaces]);
  const sessionOptions = useMemo(
    () => collectSessionFilterOptions(scopeFilterSamples, workspaceId, feed.workspaces, props.locale ?? 'th', props.sessionLabel ?? 'Session'),
    [scopeFilterSamples, workspaceId, feed.workspaces, props.locale, props.sessionLabel],
  );
  useEffect(() => {
    if (workspaceId !== null && !workspaceOptions.some((option) => option.id === workspaceId)) setWorkspaceId(null);
  }, [workspaceId, workspaceOptions]);
  useEffect(() => {
    if (sessionId !== null && !sessionOptions.some((option) => option.id === sessionId)) {
      setSessionId(null);
      void props.onSessionChange?.({ workspaceId, sessionId: null });
    }
  }, [props.onSessionChange, sessionId, sessionOptions, workspaceId]);
  const scope = useMemo<LogScopeSelection>(() => ({ workspaceId, sessionId }), [workspaceId, sessionId]);
  const candidates = useMemo(
    () => newestFirstWorkLogRows(feed.entries, feed.inFlight, props.filter, '', scope, feed.workspaces),
    [feed, props.filter, scope],
  );
  useEffect(() => {
    const query = normalizeDetailSearchQuery(search);
    const generation = ++detailSearchGeneration.current;
    if (query.length === 0 || props.onSearchTargetDetails === undefined) {
      dispatchDetailSearch({ type: 'reset', generation });
      return;
    }
    dispatchDetailSearch({ type: 'start', generation, query });
    const timeout = window.setTimeout(() => {
      const searchCandidates = candidates.flatMap((row) => {
        const detailRef = row.item.targetDetail.detailRef;
        if (detailRef === null || workLogSearchText(row).includes(query)) return [];
        return [{ id: workLogRowIdentity(row), detailRef }];
      });
      if (searchCandidates.length === 0) {
        dispatchDetailSearch({ type: 'success', generation, query, matchingIds: [] });
        return;
      }
      void props.onSearchTargetDetails?.(query, searchCandidates).then((ids) => {
        dispatchDetailSearch({ type: 'success', generation, query, matchingIds: ids });
      }).catch(() => {
        dispatchDetailSearch({ type: 'failure', generation, query });
      });
    }, 180);
    return (): void => window.clearTimeout(timeout);
  }, [candidates, props.onSearchTargetDetails, search]);
  const hiddenMatches = activeDetailMatchIds(detailSearchState, search);
  const rows = useMemo(
    () => newestFirstWorkLogRows(feed.entries, feed.inFlight, props.filter, search, scope, feed.workspaces, hiddenMatches),
    [feed, props.filter, search, scope, hiddenMatches],
  );
  const codexTasks = useMemo(() => filteredCodexTasks(
    props.filter === 'codex' ? feed.codexTasks : [],
    search,
    { workspaceId, sessionId },
    feed.workspaces,
  ), [feed, props.filter, search, workspaceId, sessionId]);
  useEffect(() => setVisibleCount(PROGRESSIVE_PAGE_SIZE), [props.filter, search, workspaceId, sessionId]);
  const visible = props.compact ? rows.slice(0, 40) : rows.slice(0, visibleCount);
  const resolvedTargets = useMemo(() => completedTargetByCallId(feed.entries), [feed]);

  function loadMoreOnScroll(event: UIEvent<HTMLDivElement>): void {
    if (props.compact || visibleCount >= rows.length) return;
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 320) return;
    setVisibleCount((current) => Math.min(rows.length, current + PROGRESSIVE_PAGE_SIZE));
  }

  async function copyRow(row: WorkLogRow): Promise<void> {
    const detailRef = row.item.targetDetail.detailRef;
    const needsFullDetail = row.item.targetDetail.itemCount > row.item.targetDetail.preview.length;
    const detail = detailRef === null || props.onResolveTargetDetail === undefined ? null : await props.onResolveTargetDetail(detailRef).catch(() => null);
    if (needsFullDetail && detail === null) {
      setCopyErrorId(row.id);
      return;
    }
    setCopyErrorId(null);
    if (!(await copyTextToClipboard(formatWorkLogCopyText(row, resolvedTargets, detail, props.locale ?? 'th')))) return;
    setCopiedId(row.id);
    window.setTimeout(() => setCopiedId((current) => current === row.id ? null : current), 1_200);
  }

  return (
    <section className={`panel worklog-panel${props.compact ? ' compact' : ''}`} aria-label={props.title}>
      <div className="section-heading">
        <h2>{props.title}</h2>
        <div className="worklog-actions">
          <button
            type="button"
            className={props.filter === 'all' ? 'active' : undefined}
            onClick={() => props.onFilterChange('all')}
          >
            {props.filterAllLabel}
          </button>
          <button
            type="button"
            className={props.filter === 'error' ? 'active' : undefined}
            onClick={() => props.onFilterChange('error')}
          >
            {props.filterErrorLabel}
          </button>
          <button
            type="button"
            className={props.filter === 'codex' ? 'active' : undefined}
            onClick={() => props.onFilterChange('codex')}
          >
            {props.filterCodexLabel ?? 'Codex'}
          </button>
          {props.onExport === undefined ? null : <button type="button" onClick={() => { void props.onExport?.(rows.map(workLogRowIdentity)); }}>{props.exportLabel ?? 'Export'}</button>}
          <button type="button" disabled={sessionId === null} onClick={() => { if (sessionId !== null) void props.onClear({ workspaceId: null, sessionId }); }}>{props.clearSessionLabel}</button>
          <button type="button" disabled={workspaceId === null} onClick={() => { if (workspaceId !== null) void props.onClear({ workspaceId, sessionId: null }); }}>{props.clearWorkspaceLabel}</button>
          <button type="button" onClick={() => { void props.onClear({ workspaceId: null, sessionId: null }); }}>{props.clearAllLabel}</button>
        </div>
      </div>
      <div className="scope-filter-bar">
        <label>
          <span>{props.workspaceLabel ?? 'Workspace'}</span>
          <select value={workspaceId ?? ''} onChange={(event) => {
            const nextWorkspaceId = event.target.value.length === 0 ? null : event.target.value;
            setWorkspaceId(nextWorkspaceId);
            if (sessionId !== null) void props.onSessionChange?.({ workspaceId: nextWorkspaceId, sessionId });
          }}>
            <option value="">{props.scopeAllLabel ?? 'All'}</option>
            {workspaceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>{props.sessionLabel ?? 'Session'}</span>
          <select value={sessionId ?? ''} onChange={(event) => {
            const nextSessionId = event.target.value.length === 0 ? null : event.target.value;
            setSessionId(nextSessionId);
            void props.onSessionChange?.({ workspaceId, sessionId: nextSessionId });
          }}>
            <option value="">{props.scopeAllLabel ?? 'All'}</option>
            {sessionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <input
        type="search"
        className="log-filter worklog-search"
        placeholder={props.searchPlaceholder ?? 'Search work log...'}
        aria-label={props.searchPlaceholder ?? 'Search work log'}
        value={search}
        onChange={(event) => {
          const nextSearch = event.target.value;
          setFeedFreeze((state) => transitionLogFeedFreeze(state, currentFeed, normalizeDetailSearchQuery(nextSearch).length > 0));
          setSearch(nextSearch);
        }}
      />
      {detailSearchState.status === 'loading' ? <p className="log-detail-search-status" role="status">{props.detailLoadingLabel ?? 'Searching complete details…'}</p> : null}
      {detailSearchState.status === 'error' ? <p className="log-detail-search-status log-detail-error" role="alert">{props.detailErrorLabel ?? 'Complete details could not be searched.'}</p> : null}
      <div className="worklog-stream" data-testid="work-log" onScroll={loadMoreOnScroll}>
        {visible.length === 0 && codexTasks.length === 0 && detailSearchState.status !== 'loading' ? <p>{props.emptyLabel}</p> : null}
        {codexTasks.map((task) => (
          <CodexTaskRow
            key={task.codexTaskId}
            task={task}
            workspaceName={feed.workspaces?.find((workspace) => workspace.id === task.workspaceId)?.displayName ?? task.workspaceId}
            locale={props.locale ?? 'th'}
            logs={props.codexTaskLogs?.[task.codexTaskId]}
            hasLogError={props.codexTaskLogErrors?.has(task.codexTaskId) ?? false}
            isStopping={props.codexTaskStoppingIds?.has(task.codexTaskId) ?? false}
            labels={props.codexLabels}
            onExpanded={props.onCodexTaskExpanded}
            onStop={props.onStopCodexTask}
          />
        ))}
        {visible.map((row) => row.kind === 'inflight' ? (
          <div key={`inflight:${row.id}`} className="worklog-line inflight">
            <time>{formatLogUiTime(row.item.startedAt, props.locale ?? 'th')}</time>
            <span className="tag task-tag">[TASK]</span>
            <strong>{row.item.toolName}</strong>
            <span className="worklog-summary"><ScopeBadges item={row.item} showWorkspace={workspaceId === null} showSession={sessionId === null} workspaces={feed.workspaces} />{row.item.targetSummary ?? ''}</span>
            <span className="worklog-duration" />
            <CopyButton row={row} copiedId={copiedId} copyLabel={props.copyLabel} copiedLabel={props.copiedLabel} onCopy={copyRow} />
            {copyErrorId === row.id ? <p className="log-detail-error row-copy-error" role="alert">{props.detailErrorLabel ?? 'Complete details are unavailable; nothing was copied.'}</p> : null}
            <ExpandableTargetDetail {...detailProps(props)} reference={row.item.targetDetail} legacySummary={row.item.targetSummary} {...(props.onResolveTargetDetail === undefined ? {} : { loadDetail: props.onResolveTargetDetail })} />
          </div>
        ) : (
          <div key={`entry:${row.item.id}`} className={`worklog-line ${row.item.kind}`}>
            <time>{formatLogUiTime(row.item.timestamp, props.locale ?? 'th')}</time>
            <span className={`tag ${row.item.kind}-tag`}>{tagFor(row.item.kind)}</span>
            <strong>{row.item.toolName}</strong>
            <span className="worklog-summary"><ScopeBadges item={row.item} showWorkspace={workspaceId === null} showSession={sessionId === null} workspaces={feed.workspaces} />{renderEntryDetail(row.item, resolvedTargets)}</span>
            {row.item.kind !== 'task' ? <em>{row.item.durationMs}ms</em> : <span className="worklog-duration" />}
            <CopyButton row={row} copiedId={copiedId} copyLabel={props.copyLabel} copiedLabel={props.copiedLabel} onCopy={copyRow} />
            {copyErrorId === row.id ? <p className="log-detail-error row-copy-error" role="alert">{props.detailErrorLabel ?? 'Complete details are unavailable; nothing was copied.'}</p> : null}
            <ExpandableTargetDetail {...detailProps(props)} reference={row.item.targetDetail} legacySummary={row.item.targetSummary} {...(props.onResolveTargetDetail === undefined ? {} : { loadDetail: props.onResolveTargetDetail })} />
          </div>
        ))}
      </div>
    </section>
  );
}

const defaultCodexLabels: CodexWorkLogLabels = {
  task: 'Codex task',
  statuses: {
    starting: 'Starting', running: 'Running', exited: 'Finished', failed: 'Failed', stopped: 'Stopped', timed_out: 'Timed out', termination_unverified: 'Checking stop',
  },
  elapsed: 'Elapsed', finished: 'Finished', output: 'Output', noOutput: 'No output yet', truncated: 'Showing the latest output',
  stop: 'Stop', stopping: 'Stopping…', model: 'Model', reasoning: 'Reasoning', logError: 'Codex output is unavailable',
  exitCode: 'Exit code',
};

function filteredCodexTasks(
  tasks: readonly CodexTaskMonitorItem[],
  search: string,
  scope: LogScopeSelection,
  workspaces: readonly WorkspaceSummary[] | undefined,
): readonly CodexTaskMonitorItem[] {
  const needle = search.trim().toLowerCase();
  return tasks.filter((task) => {
    if (scope.sessionId !== null || (scope.workspaceId !== null && !workspaceScopeMatches(workspaces ?? [], task.workspaceId, scope.workspaceId))) return false;
    if (needle.length === 0) return true;
    const workspaceName = workspaces?.find((workspace) => workspace.id === task.workspaceId)?.displayName ?? '';
    return `${task.codexTaskId} ${task.workspaceId} ${workspaceName} ${task.state}`.toLowerCase().includes(needle);
  }).sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

function CodexTaskRow(props: {
  readonly task: CodexTaskMonitorItem;
  readonly workspaceName: string;
  readonly locale: UiLocale;
  readonly logs: CodexTaskLogsResult | undefined;
  readonly hasLogError: boolean;
  readonly isStopping: boolean;
  readonly labels: CodexWorkLogLabels | undefined;
  readonly onExpanded: ((codexTaskId: string, expanded: boolean) => void) | undefined;
  readonly onStop: ((codexTaskId: string) => Promise<void>) | undefined;
}): ReactElement {
  const labels = props.labels ?? defaultCodexLabels;
  const task = props.task;
  const startedAt = Date.parse(task.startedAt);
  const finishedAt = task.finishedAt;
  const live = task.state === 'starting' || task.state === 'running';
  const canStop = live || task.state === 'termination_unverified';
  const displayState = task.state === 'exited' && task.exitCode !== undefined && task.exitCode !== 0 ? 'failed' : task.state;
  const durationMs = Math.max(0, Date.parse(finishedAt ?? new Date().toISOString()) - startedAt);
  const model = parseCodexLogHeader(props.logs?.entries ?? []);
  const output = props.logs?.entries.map((entry) => `${entry.stream}: ${entry.text}`).join('\n');
  return (
    <div className={`worklog-line codex-task ${task.state}`} data-codex-task-id={task.codexTaskId}>
      <time>{formatLogUiTime(finishedAt ?? task.startedAt, props.locale)}</time>
      <strong>{labels.task}</strong>
      <span className="codex-task-state">{labels.statuses[displayState]}</span>
      <span className="worklog-summary">{props.workspaceName}</span>
      <code>{task.codexTaskId}</code>
      <em>{live ? `${labels.elapsed} ${formatCodexDuration(durationMs, props.locale)}` : `${labels.finished} ${finishedAt === undefined ? '' : formatLogUiTime(finishedAt, props.locale)}`}</em>
      {!canStop || props.onStop === undefined ? null : (
        <button type="button" disabled={props.isStopping} onClick={() => { void props.onStop?.(task.codexTaskId); }}>
          {props.isStopping ? labels.stopping : labels.stop}
        </button>
      )}
      <details className="codex-task-details" onToggle={(event) => props.onExpanded?.(task.codexTaskId, event.currentTarget.open)}>
        <summary>{labels.output}</summary>
        {model.model === undefined ? null : <p>{labels.model}: {model.model}</p>}
        {model.reasoning === undefined ? null : <p>{labels.reasoning}: {model.reasoning}</p>}
        {task.exitCode === undefined ? null : <p>{labels.exitCode}: {task.exitCode}</p>}
        {props.hasLogError ? <p role="alert">{labels.logError}</p> : null}
        {props.logs?.truncated ? <p>{labels.truncated}</p> : null}
        <pre>{output === undefined || output.length === 0 ? labels.noOutput : output}</pre>
      </details>
    </div>
  );
}

function formatCodexDuration(milliseconds: number, locale: UiLocale): string {
  const seconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const minutesText = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(minutes);
  const secondsText = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(remainingSeconds);
  return `${minutesText} ${secondsText}`;
}

export function parseCodexLogHeader(entries: CodexTaskLogsResult['entries']): { readonly model?: string; readonly reasoning?: string } {
  const header = entries.slice(0, 20).map((entry) => entry.text).join('\n');
  const model = /\b["']?model["']?\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9_.:/+-]{0,127})/i.exec(header)?.[1];
  const reasoning = /\b["']?reasoning(?:[\s_-]+effort)?["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{1,48})/i.exec(header)?.[1];
  return { ...(model === undefined ? {} : { model }), ...(reasoning === undefined ? {} : { reasoning }) };
}

function CopyButton(props: {
  readonly row: WorkLogRow;
  readonly copiedId: string | null;
  readonly copyLabel: string | undefined;
  readonly copiedLabel: string | undefined;
  readonly onCopy: (row: WorkLogRow) => Promise<void>;
}): ReactElement {
  const copied = props.copiedId === props.row.id;
  const label = copied ? (props.copiedLabel ?? 'Copied') : (props.copyLabel ?? 'Copy full log');
  return (
    <button type="button" className="row-copy-button" title={label} aria-label={label} onClick={() => { void props.onCopy(props.row); }}>
      {copied ? '✓' : '⧉'}
    </button>
  );
}

export function newestFirstWorkLogRows(
  entries: readonly WorkLogEntry[],
  inFlight: readonly InFlightWorkItem[],
  filter: WorkLogFilter = 'all',
  search = '',
  scope: LogScopeSelection = { workspaceId: null, sessionId: null },
  workspaces: readonly WorkspaceSummary[] = [],
  hiddenMatches: ReadonlySet<string> = new Set(),
): readonly WorkLogRow[] {
  const needle = search.trim().toLowerCase();
  const scopedEntries = entries.filter((entry) => matchesScope(entry, scope, workspaces));
  const scopedInFlight = inFlight.filter((entry) => matchesScope(entry, scope, workspaces));
  const matchingEntries = filter === 'error'
    ? scopedEntries.filter((entry) => entry.kind === 'error')
    : filter === 'codex'
      ? scopedEntries.filter((entry) => isCodexRelatedActivity(entry.toolName))
      : scopedEntries;
  const entryRows = matchingEntries
    .map((item): WorkLogRow => ({ kind: 'entry', timestamp: item.timestamp, id: item.id, item }));
  const inFlightRows = filter === 'error'
    ? []
    : (filter === 'codex' ? scopedInFlight.filter((item) => isCodexRelatedActivity(item.toolName)) : scopedInFlight)
      .map((item): WorkLogRow => ({ kind: 'inflight', timestamp: item.startedAt, id: scopedActivityId(item), item }));
  return [...entryRows, ...inFlightRows]
    .filter((row) => needle.length === 0 || workLogSearchText(row).includes(needle) || hiddenMatches.has(workLogRowIdentity(row)))
    .sort((left, right) => {
      const leftTime = Date.parse(left.timestamp);
      const rightTime = Date.parse(right.timestamp);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
      const timestampOrder = right.timestamp.localeCompare(left.timestamp);
      return timestampOrder !== 0 ? timestampOrder : right.id.localeCompare(left.id);
    });
}

function isCodexRelatedActivity(toolName: string): boolean {
  return toolName.startsWith('codex_') || toolName.startsWith('agent_swarm_')
    || toolName === 'delegate' || toolName.startsWith('delegate_')
    || toolName === 'parallel_delegate' || toolName === 'task_create' || toolName === 'task_cancel';
}

function workLogSearchText(row: WorkLogRow): string {
  if (row.kind === 'inflight') {
    return `${row.item.callId} ${row.item.toolName} ${row.item.targetSummary ?? ''} ${row.item.workspaceId ?? ''} ${row.item.sessionId ?? ''} task`.toLowerCase();
  }
  return `${row.item.id} ${row.item.callId ?? ''} ${row.item.toolName} ${row.item.resultCode} ${row.item.targetSummary ?? ''} ${row.item.errorMessage ?? ''} ${row.item.workspaceId ?? ''} ${row.item.sessionId ?? ''} ${row.item.kind}`.toLowerCase();
}


function matchesScope(item: Pick<WorkLogEntry, 'workspaceId' | 'sessionId'> | Pick<InFlightWorkItem, 'workspaceId' | 'sessionId'>, scope: LogScopeSelection, workspaces: readonly WorkspaceSummary[]): boolean {
  if (scope.workspaceId !== null && !workspaceScopeMatches(workspaces, item.workspaceId, scope.workspaceId)) return false;
  if (scope.sessionId !== null && item.sessionId !== scope.sessionId) return false;
  return true;
}

function scopedActivityId(item: InFlightWorkItem): string {
  if (item.workspaceId === null && item.sessionId === null) return item.callId;
  return [item.workspaceId ?? 'global', item.sessionId ?? 'global', item.callId].join(':');
}

function ScopeBadges(props: { readonly item: Pick<WorkLogEntry, 'workspaceId' | 'sessionId'> | Pick<InFlightWorkItem, 'workspaceId' | 'sessionId'>; readonly showWorkspace: boolean; readonly showSession: boolean; readonly workspaces: readonly WorkspaceSummary[] | undefined }): ReactElement | null {
  const workspaceLabel = props.item.workspaceId === null ? null : displayWorkspaceLabel(props.workspaces, props.item.workspaceId);
  const sessionLabel = props.item.sessionId === null ? null : shortScopeId(props.item.sessionId);
  if ((!props.showWorkspace || workspaceLabel === null) && (!props.showSession || sessionLabel === null)) return null;
  return <span className="scope-badges">
    {props.showWorkspace && workspaceLabel !== null ? <span className="scope-badge workspace">{workspaceLabel}</span> : null}
    {props.showSession && sessionLabel !== null ? <span className="scope-badge session">{sessionLabel}</span> : null}
  </span>;
}

function displayWorkspaceLabel(workspaces: readonly WorkspaceSummary[] | undefined, workspaceId: string): string {
  const workspaceList = workspaces ?? [];
  const canonicalId = canonicalWorkspaceScopeId(workspaceList, workspaceId);
  const workspace = workspaceList.find((candidate) => candidate.id === canonicalId);
  if (workspace === undefined) return shortScopeId(canonicalId);
  const duplicateName = (workspaces ?? []).some((candidate) => candidate.id !== workspace.id && candidate.displayName.trim().toLocaleLowerCase() === workspace.displayName.trim().toLocaleLowerCase());
  return duplicateName
    ? `${workspace.displayName} — ${workspace.id} — ${workspace.realRootPath}`
    : `${workspace.displayName} — ${workspace.id}`;
}

function shortScopeId(value: string): string {
  // Scope identifiers are diagnostic evidence; never abbreviate them in logs.
  return value;
}

function renderEntryDetail(entry: WorkLogEntry, resolvedTargets: ReadonlyMap<string, string>): ReactElement | string {
  const targetSummary = resolvedTargetSummary(entry, resolvedTargets);
  if (entry.kind === 'error') {
    if (targetSummary && entry.errorMessage) {
      return (
        <>
          <span>{targetSummary}</span>
          <span className="worklog-error-detail"> — {entry.errorMessage}</span>
        </>
      );
    }
    if (entry.errorMessage) return <span className="worklog-error-detail">{entry.errorMessage}</span>;
    return targetSummary ?? legacyEntryDetail(entry);
  }
  return targetSummary ?? legacyEntryDetail(entry);
}

function entryDetailText(entry: WorkLogEntry, resolvedTargets: ReadonlyMap<string, string>): string {
  const targetSummary = resolvedTargetSummary(entry, resolvedTargets);
  if (entry.kind === 'error') {
    if (targetSummary && entry.errorMessage) return `${targetSummary} — ${entry.errorMessage}`;
    return entry.errorMessage ?? targetSummary ?? legacyEntryDetail(entry);
  }
  return targetSummary ?? legacyEntryDetail(entry);
}

export function formatWorkLogCopyText(row: WorkLogRow, resolvedTargets: ReadonlyMap<string, string> = new Map(), detail: ActivityTargetDetail | null = null, locale: UiLocale = 'th'): string {
  if (row.kind === 'inflight') {
    const base = `${formatLogExportDateTime(row.item.startedAt, locale)} [TASK] ${row.item.toolName}${row.item.targetSummary === null ? '' : ` ${row.item.targetSummary}`}`;
    return appendCompleteTargetDetail(`${base}\r\n${workLogMetadataLines(row).join('\r\n')}`, detail, locale);
  }
  const duration = row.item.kind === 'task' ? '' : ` ${row.item.durationMs}ms`;
  const base = `${formatLogExportDateTime(row.item.timestamp, locale)} ${tagFor(row.item.kind)} ${row.item.toolName} ${entryDetailText(row.item, resolvedTargets)}${duration}`.trim();
  return appendCompleteTargetDetail(`${base}\r\n${workLogMetadataLines(row).join('\r\n')}`, detail, locale);
}

function workLogMetadataLines(row: WorkLogRow): readonly string[] {
  if (row.kind === 'inflight') {
    return [
      `rowId=inflight:${row.item.callId}`,
      `callId=${row.item.callId}`,
      `workspaceId=${row.item.workspaceId ?? '<none>'}`,
      `sessionId=${row.item.sessionId ?? '<none>'}`,
      `toolName=${row.item.toolName}`,
      'phase=started',
      'resultCode=STARTED',
      ...(row.item.targetSummary === null ? [] : [`targetSummary=${row.item.targetSummary}`]),
    ];
  }
  return [
    `rowId=audit:${row.item.id}`,
    `eventId=${row.item.id}`,
    `callId=${row.item.callId ?? '<none>'}`,
    `workspaceId=${row.item.workspaceId ?? '<none>'}`,
    `sessionId=${row.item.sessionId ?? '<none>'}`,
    `toolName=${row.item.toolName}`,
    `kind=${row.item.kind}`,
    `resultCode=${row.item.resultCode}`,
    `durationMs=${row.item.durationMs}`,
    ...(row.item.targetSummary === null ? [] : [`targetSummary=${row.item.targetSummary}`]),
    ...(row.item.errorMessage === null ? [] : [`errorMessage=${row.item.errorMessage}`]),
  ];
}

export function workLogRowIdentity(row: WorkLogRow): string {
  return row.kind === 'inflight' ? `inflight:${row.item.callId}` : `audit:${row.item.id}`;
}

function appendCompleteTargetDetail(base: string, detail: ActivityTargetDetail | null, locale: UiLocale): string {
  if (detail === null || detail.items.length === 0) return base;
  const heading = detail.kind === 'files' ? 'Files' : detail.kind === 'tools' ? 'Tools' : 'Details';
  return `${base}\r\n${heading}:\r\n${detail.items.map((item) => `- ${formatDisplayTimestampItem(item, locale)}`).join('\r\n')}`;
}

function detailProps(props: WorkLogPanelProps): Omit<ComponentProps<typeof ExpandableTargetDetail>, 'reference' | 'legacySummary' | 'loadDetail'> {
  return {
    locale: props.locale ?? 'th',
    showMoreLabel: props.showMoreLabel ?? 'Show more',
    showLessLabel: props.showLessLabel ?? 'Show less',
    detailHeadingLabel: props.detailHeadingLabel ?? 'Target items',
    loadingLabel: props.detailLoadingLabel ?? 'Loading complete details…',
    errorLabel: props.detailErrorLabel ?? 'Complete details are unavailable.',
    emptyLabel: props.detailEmptyLabel ?? 'No target items.',
    legacyIncompleteLabel: props.legacyIncompleteLabel ?? 'Older log: the omitted items were not retained.',
  };
}

function completedTargetByCallId(entries: readonly WorkLogEntry[]): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === 'task' || entry.callId === undefined || entry.targetSummary === null || entry.targetSummary.trim().length === 0) continue;
    targets.set(entry.callId, entry.targetSummary);
  }
  return targets;
}

function resolvedTargetSummary(entry: WorkLogEntry, resolvedTargets: ReadonlyMap<string, string>): string | null {
  if (entry.targetSummary !== null && entry.targetSummary.trim().length > 0) {
    if (entry.kind !== 'task' || entry.callId === undefined) return entry.targetSummary;
    return resolvedTargets.get(entry.callId) ?? entry.targetSummary;
  }
  if (entry.callId === undefined) return null;
  return resolvedTargets.get(entry.callId) ?? null;
}

function legacyEntryDetail(entry: WorkLogEntry): string {
  if (entry.kind === 'task' || entry.resultCode === 'SUCCESS') return 'details unavailable (legacy log)';
  return `${entry.resultCode} · details unavailable (legacy log)`;
}

function tagFor(kind: WorkLogEntry['kind']): string {
  if (kind === 'task') return '[TASK]';
  if (kind === 'error') return '[ERROR]';
  return '[RESULT]';
}

export type { MessageKey };
export { activeDetailMatchIds, activeLogFeed, createDetailSearchState, reduceDetailSearchState, transitionLogFeedFreeze };
