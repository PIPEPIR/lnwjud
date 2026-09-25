import { useState, type ReactElement } from 'react';
import type { DashboardSnapshot, GitStatusEntrySummary, UiLocale, WorkspaceSummary } from '@lnwjud/ipc-contracts';
import { createTranslator } from '../../i18n/index.js';
import { SplitDiffViewer } from './SplitDiffViewer.js';

interface GitPageProps {
  readonly locale: UiLocale;
  readonly gitSummary: DashboardSnapshot['gitSummary'];
  readonly selectedWorkspace?: WorkspaceSummary | null;
  readonly workspaces?: readonly WorkspaceSummary[];
  readonly onSelectWorkspace?: (workspaceId: string) => Promise<void>;
  readonly onRefresh?: () => Promise<void>;
}

export function GitPage({
  locale,
  gitSummary,
  selectedWorkspace,
  workspaces = [],
  onSelectWorkspace,
  onRefresh,
}: GitPageProps): ReactElement {
  const t = createTranslator(locale);
  const isClean = gitSummary.changedFiles === 0 && gitSummary.stagedFiles === 0;
  const isRepo = gitSummary.isRepo ?? (gitSummary.message !== 'Not a Git repository' && gitSummary.message !== 'No workspace selected');
  const currentPath = gitSummary.repositoryPath ?? selectedWorkspace?.realRootPath ?? '—';

  const [selectedFile, setSelectedFile] = useState<GitStatusEntrySummary | null>(null);
  const [selectedStaged, setSelectedStaged] = useState(false);
  const [diffData, setDiffData] = useState<{
    patch: string;
    oldContent?: string;
    newContent?: string;
    additions?: number;
    deletions?: number;
    loading: boolean;
    error?: string;
  } | null>(null);

  const handleOpenFileDiff = async (
    entry: GitStatusEntrySummary,
    staged = entry.indexStatus !== ' ' && entry.worktreeStatus === ' ',
  ): Promise<void> => {
    if (!selectedWorkspace) return;
    setSelectedFile(entry);
    setSelectedStaged(staged);
    setDiffData({ patch: '', loading: true });
    try {
      const res = await window.lnwjud.getGitDiff({
        workspaceId: selectedWorkspace.id,
        path: entry.path,
        staged,
      });
      setDiffData({
        patch: res.patch,
        ...(res.oldContent !== undefined ? { oldContent: res.oldContent } : {}),
        ...(res.newContent !== undefined ? { newContent: res.newContent } : {}),
        ...(res.additions !== undefined ? { additions: res.additions } : {}),
        ...(res.deletions !== undefined ? { deletions: res.deletions } : {}),
        loading: false,
      });
    } catch (err: unknown) {
      setDiffData({
        patch: '',
        loading: false,
        error: err instanceof Error ? err.message : t('git.diffLoadError'),
      });
    }
  };

  return (
    <div className="page-content viewport-list-page git-page">
      <div className="page-heading">
        <div>
          <h1>{t('git.title')}</h1>
          <p className="page-subtitle">{t('git.subtitle')}</p>
          <p className="hint">{t('git.projectLabel')}: {selectedWorkspace?.displayName ?? '—'} · {currentPath}</p>
        </div>
        <div className="heading-actions">
          {workspaces.length > 1 && onSelectWorkspace !== undefined ? (
            <div className="form-row">
              <select
                aria-label={t('git.selectWorkspace')}
                className="settings-select"
                value={selectedWorkspace?.id ?? ''}
                onChange={(event) => { void onSelectWorkspace(event.target.value); }}
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.displayName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {onRefresh === undefined ? null : (
            <button type="button" onClick={() => { void onRefresh(); }}>
              {t('action.refresh')}
            </button>
          )}
        </div>
      </div>

      <section className="git-panel">
        <div className="git-summary-strip">
          <strong className="git-summary-message" data-testid="git-summary">{gitSummary.message}</strong>
          <div className="git-summary-stats" aria-label={t('git.statusSummary')}>
            <span>
              <span className="git-summary-label">{t('git.branch')}</span>
              <strong>{gitSummary.branch ?? '—'}</strong>
            </span>
            <span>
              <span className="git-summary-label">{t('git.changed')}</span>
              <strong>{gitSummary.changedFiles}</strong>
            </span>
            <span>
              <span className="git-summary-label">{t('git.staged')}</span>
              <strong>{gitSummary.stagedFiles}</strong>
            </span>
            <span>
              <span className="git-summary-label">{t('git.workingTree')}</span>
              <strong className={!isRepo ? '' : isClean ? 'status-clean' : 'status-dirty'}>
                {!isRepo ? '—' : isClean ? t('git.clean') : t('git.modified')}
              </strong>
            </span>
          </div>
        </div>

        {selectedFile !== null ? (
          <div className="git-diff-container-section">
            {diffData?.loading ? (
              <div className="diff-loading-box">
                <span>{t('git.loadingDiff')}</span>
              </div>
            ) : diffData?.error ? (
              <div className="diff-error-box">
                <p>{diffData.error}</p>
                <button type="button" onClick={() => { setSelectedFile(null); }}>
                  {t('git.close')}
                </button>
              </div>
            ) : (
              <>
                {selectedFile.indexStatus !== ' ' && selectedFile.indexStatus !== '?' && selectedFile.worktreeStatus !== ' ' ? (
                  <div className="diff-view-toggle" aria-label={t('git.diffScope')}>
                    <button
                      type="button"
                      className={`toggle-btn ${selectedStaged ? 'active' : ''}`}
                      onClick={() => { void handleOpenFileDiff(selectedFile, true); }}
                    >
                      HEAD → Index (Staged)
                    </button>
                    <button
                      type="button"
                      className={`toggle-btn ${selectedStaged ? '' : 'active'}`}
                      onClick={() => { void handleOpenFileDiff(selectedFile, false); }}
                    >
                      Index → Working Tree (Unstaged)
                    </button>
                  </div>
                ) : null}
                <SplitDiffViewer
                  locale={locale}
                  filePath={selectedFile.path}
                  patch={diffData?.patch ?? ''}
                  oldContent={diffData?.oldContent}
                  newContent={diffData?.newContent}
                  additions={diffData?.additions}
                  deletions={diffData?.deletions}
                  oldLabel={selectedStaged ? 'HEAD' : 'Index'}
                  newLabel={selectedStaged ? 'Index (Staged)' : 'Working Tree'}
                  onClose={() => { setSelectedFile(null); }}
                />
              </>
            )}
          </div>
        ) : null}

        {!isRepo ? (
          <div className="git-not-repo-notice">
            <div className="git-notice-header">
              <div>
                <strong>{t('git.notRepoTitle')}</strong>
                <p className="hint">
                  {t('git.notRepoHint', { path: currentPath })}
                </p>
              </div>
            </div>
            {workspaces.filter((ws) => ws.id !== selectedWorkspace?.id).length > 0 && onSelectWorkspace !== undefined ? (
              <div className="git-switch-list">
                {workspaces.filter((ws) => ws.id !== selectedWorkspace?.id).map((ws) => (
                  <div key={ws.id} className="git-switch-item">
                    <div>
                      <strong>{ws.displayName}</strong>
                      <p className="hint">{ws.realRootPath}</p>
                    </div>
                    <button type="button" onClick={() => { void onSelectWorkspace(ws.id); }}>
                      {t('git.switchProject')}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="git-files-section">
            <div className="git-files-header">
              <h3>{t('git.changedFilesTitle')}</h3>
              <span className="hint">
                {t('git.changedFilesHint')}
              </span>
            </div>
            <div className={`git-file-list ${gitSummary.entries !== undefined && gitSummary.entries.length > 0 ? '' : 'empty'}`}>
              {gitSummary.entries !== undefined && gitSummary.entries.length > 0 ? gitSummary.entries.map((entry) => {
                const isSelected = selectedFile?.path === entry.path;
                return (
                  <div
                    key={entry.path}
                    className={`git-file-item clickable-file-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => { void handleOpenFileDiff(entry); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        void handleOpenFileDiff(entry);
                      }
                    }}
                  >
                    <span className={`git-file-tag ${entry.kind}`}>
                      [{entry.kind.toUpperCase()}]
                    </span>
                    <span className="git-file-path">{entry.path}</span>
                    <div className="git-file-stats">
                      {typeof entry.additions === 'number' && entry.additions > 0 ? (
                        <span className="stat-badge stat-add" title={t('git.linesAdded', { count: entry.additions })}>
                          +{entry.additions}
                        </span>
                      ) : null}
                      {typeof entry.deletions === 'number' && entry.deletions > 0 ? (
                        <span className="stat-badge stat-del" title={t('git.linesDeleted', { count: entry.deletions })}>
                          -{entry.deletions}
                        </span>
                      ) : null}
                    </div>
                    <span className="git-file-status">
                      {entry.indexStatus !== ' ' && entry.indexStatus !== '?' && entry.worktreeStatus !== ' '
                        ? 'Staged + Unstaged'
                        : entry.indexStatus !== ' ' && entry.indexStatus !== '?' ? 'Staged' : 'Unstaged'}
                    </span>
                    <span className="git-view-diff-arrow">{t('git.viewDiff')}</span>
                  </div>
                );
              }) : (
                <div className="git-file-empty">
                  <strong>{t('git.noChangedFiles')}</strong>
                  <span className="hint">{t('git.workingTreeClean')}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
