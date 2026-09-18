import { useMemo, useState, type ReactElement } from 'react';
import type { ResolvedRemediation, ToolCatalogItem, ToolCatalogSnapshot, ToolCategory, ToolDeclaredPermission, ToolOrigin, ToolProfileDecision, ToolReadinessStatus, UiLocale } from '@lnwjud/ipc-contracts';
import { createTranslator, type Translator } from '../../i18n/index.js';
import { ToolAvailabilitySwitch } from './ToolAvailabilitySwitch.js';
import { ToolDetailModal } from './ToolDetailModal.js';
import { catalogStatusCounts, filterAndSortTools, toolControlCanEnable, toolControlEnabled, type ToolCatalogFilters } from './tool-catalog-view.js';
import { toolAvailabilityLabel } from './tool-availability-copy.js';
import { coarseReadinessLabel, toolReadinessLabel } from './tool-readiness-copy.js';

interface ToolsPageProps {
  readonly locale: UiLocale;
  readonly snapshot: ToolCatalogSnapshot | null;
  readonly loading: boolean;
  readonly hostSyncNotice?: string | null;
  readonly onRefresh: () => Promise<void>;
  readonly onRemediation: (action: ResolvedRemediation['actions'][number]) => Promise<void>;
  readonly onSetAvailability?: (name: string, enabled: boolean) => Promise<void>;
  readonly onResetAvailability?: (name: string) => Promise<void>;
}

const categories: readonly ToolCategory[] = ['workspace','files','search_context','git','process','browser_desktop','system','office_media','automation','agent_goals','extensions'];
const statuses: readonly ToolReadinessStatus[] = ['ready','needs_setup','blocked','disabled','unsupported','unknown'];
const permissions: readonly ToolDeclaredPermission[] = ['READ','WRITE','EXECUTE','DANGEROUS','UNKNOWN'];
const decisions: readonly ToolProfileDecision[] = ['ALLOW','ASK','DENY','UNKNOWN'];

export function ToolsPage({ locale, snapshot, loading, hostSyncNotice = null, onRefresh, onRemediation, onSetAvailability, onResetAvailability }: ToolsPageProps): ReactElement {
  const t = createTranslator(locale);
  const [origin, setOrigin] = useState<ToolOrigin>('lnwjud');
  const [query, setQuery] = useState('');
  const [readiness, setReadiness] = useState<ToolReadinessStatus | 'all'>('all');
  const [availability, setAvailability] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [category, setCategory] = useState<ToolCategory | 'all'>('all');
  const [permission, setPermission] = useState<ToolDeclaredPermission | 'all'>('all');
  const [profileDecision, setProfileDecision] = useState<ToolProfileDecision | 'all'>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busyToolKey, setBusyToolKey] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const items = snapshot?.items ?? [];
  const selected = selectedKey === null ? null : items.find((item) => toolKey(item) === selectedKey) ?? null;
  const filters: ToolCatalogFilters = { origin, query, readiness, availability, category, permission, profileDecision };
  const visible = useMemo(() => filterAndSortTools(items, filters), [items, origin, query, readiness, availability, category, permission, profileDecision]);
  const originItems = items.filter((item) => item.origin === origin);
  const counts = catalogStatusCounts(originItems);
  const remediationById = new Map((snapshot?.remediations ?? []).map((remediation) => [remediation.id, remediation] as const));

  const mutateAvailability = async (item: ToolCatalogItem, enabled: boolean): Promise<void> => {
    if (item.origin !== 'lnwjud' || onSetAvailability === undefined || busyToolKey !== null) return;
    const key = toolKey(item);
    setBusyToolKey(key);
    setAvailabilityError(null);
    try {
      await onSetAvailability(item.name, enabled);
    } catch (cause: unknown) {
      setAvailabilityError(cause instanceof Error ? cause.message : t('app.toolAvailabilityChangeError'));
    } finally {
      setBusyToolKey(null);
    }
  };

  const resetAvailability = async (item: ToolCatalogItem): Promise<void> => {
    if (item.origin !== 'lnwjud' || onResetAvailability === undefined || busyToolKey !== null) return;
    const key = toolKey(item);
    setBusyToolKey(key);
    setAvailabilityError(null);
    try {
      await onResetAvailability(item.name);
    } catch (cause: unknown) {
      setAvailabilityError(cause instanceof Error ? cause.message : t('app.toolAvailabilityResetError'));
    } finally {
      setBusyToolKey(null);
    }
  };

  return (
    <section className="panel tools-page" aria-labelledby="tools-heading">
      <div className="section-heading tools-heading"><div><h1 id="tools-heading">{t('nav.tools')}</h1><p className="page-subtitle">{t('tools.subtitle')}</p></div><button type="button" disabled={loading} onClick={() => { void onRefresh(); }}>{loading ? t('tools.checking') : t('tools.recheckAll')}</button></div>
      <div className="tool-origin-tabs" role="tablist" aria-label={t('tools.origin')}>
        <button type="button" role="tab" aria-selected={origin === 'lnwjud'} className={origin === 'lnwjud' ? 'active' : undefined} onClick={() => setOrigin('lnwjud')}>lnwjud ({items.filter((item) => item.origin === 'lnwjud').length})</button>
        <button type="button" role="tab" aria-selected={origin === 'external_mcp'} className={origin === 'external_mcp' ? 'active' : undefined} onClick={() => { setOrigin('external_mcp'); setAvailability('all'); }}>External MCP ({items.filter((item) => item.origin === 'external_mcp').length})</button>
      </div>
      <div className="tool-status-strip" aria-label={t('tools.statusCounts')}>{statuses.map((status) => <button type="button" key={status} aria-pressed={readiness === status} className={readiness === status ? 'active' : undefined} onClick={() => setReadiness(readiness === status ? 'all' : status)}><strong>{counts[status]}</strong><span>{coarseReadinessLabel(locale, status)}</span></button>)}</div>
      <div className="tool-filters">
        <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t('tools.searchPlaceholder')} aria-label={t('tools.searchAria')} />
        <select value={availability} disabled={origin !== 'lnwjud'} onChange={(event) => setAvailability(event.currentTarget.value as 'all' | 'enabled' | 'disabled')} aria-label={t('tools.availability')}><option value="all">{t('tools.allAvailability')}</option><option value="enabled">{t('security.enabled')}</option><option value="disabled">{t('security.disabled')}</option></select>
        <select value={category} onChange={(event) => setCategory(event.currentTarget.value as ToolCategory | 'all')} aria-label={t('tools.category')}><option value="all">{t('tools.allCategories')}</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as ToolDeclaredPermission | 'all')} aria-label={t('tools.permission')}><option value="all">{t('tools.allPermissions')}</option>{permissions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={profileDecision} onChange={(event) => setProfileDecision(event.currentTarget.value as ToolProfileDecision | 'all')} aria-label={t('tools.profileDecision')}><option value="all">{t('tools.allDecisions')}</option>{decisions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <button type="button" onClick={() => { setQuery(''); setReadiness('all'); setAvailability('all'); setCategory('all'); setPermission('all'); setProfileDecision('all'); }}>{t('tools.clearFilters')}</button>
      </div>
      {availabilityError === null ? null : <p className="tool-action-error" role="alert">{availabilityError}</p>}
      {hostSyncNotice === null ? null : <p className="tool-host-sync-notice" role="status">{hostSyncNotice}</p>}
      {snapshot === null ? <div className="doctor-empty-state"><p>{t('tools.catalogNotLoaded')}</p></div> : visible.length === 0 ? <div className="doctor-empty-state"><p>{t('tools.noMatches')}</p></div> : <div className="tool-card-list">{visible.map((item) => {
        const key = toolKey(item);
        const busy = busyToolKey === key;
        return <article className={`tool-card tool-${item.readiness}`} key={key}><button type="button" className="tool-card-open" onClick={() => setSelectedKey(key)}><span className="tool-status-dot" aria-hidden="true"/><span className="tool-card-main"><span><strong>{item.title}</strong><code>{item.name}</code></span><small>{item.shortDescription}</small>{item.readiness === 'ready' ? null : <small className="tool-card-remediation-hint">↳ {remediationHint(t, item, remediationById)}</small>}</span><span className="tool-card-meta"><span>{toolReadinessLabel(locale, item)}</span>{item.origin === 'lnwjud' ? <span className={item.effectiveExposed ? 'tool-availability-on' : 'tool-availability-off'}>{toolAvailabilityLabel(locale, item)}</span> : null}<span>{permissionLabel(t, item)}</span><span>{profileDecisionLabel(t, item)}</span></span></button>{item.origin === 'lnwjud' ? <div className="tool-card-availability"><ToolAvailabilitySwitch locale={locale} checked={toolControlEnabled(item)} busy={busy} disabled={onSetAvailability === undefined || (!toolControlEnabled(item) && !toolControlCanEnable(item))} blockedLabel={!toolControlEnabled(item) && !toolControlCanEnable(item) ? t('tools.setupFirst') : undefined} label={item.title} onChange={(enabled) => { void mutateAvailability(item, enabled); }} />{item.userPreference === 'default' ? null : <button type="button" disabled={busy || onResetAvailability === undefined} onClick={() => { void resetAvailability(item); }}>{t('tools.useDefault')}</button>}</div> : <div className="tool-card-availability tool-card-availability-readonly">{t('tools.managedExternal')}</div>}</article>;
      })}</div>}
      {selected !== null && snapshot !== null ? <ToolDetailModal locale={locale} item={selected} remediations={snapshot.remediations} onClose={() => setSelectedKey(null)} onRemediation={onRemediation} availabilityBusy={busyToolKey === toolKey(selected)} {...(onSetAvailability === undefined ? {} : { onSetAvailability: (enabled: boolean) => mutateAvailability(selected, enabled) })} {...(onResetAvailability === undefined ? {} : { onResetAvailability: () => resetAvailability(selected) })} /> : null}
    </section>
  );
}

function toolKey(item: ToolCatalogItem): string {
  return `${item.origin}:${item.serverName ?? ''}:${item.name}`;
}

function permissionLabel(t: Translator, item: ToolCatalogItem): string {
  if (item.origin !== 'external_mcp' || item.declaredPermission !== 'UNKNOWN') return item.declaredPermission;
  return t('tools.permissionNotDeclared');
}

function profileDecisionLabel(t: Translator, item: ToolCatalogItem): string {
  if (item.origin !== 'external_mcp' || item.profileDecision !== 'UNKNOWN') return item.profileDecision;
  return t('tools.notClassified');
}

function remediationHint(t: Translator, item: ToolCatalogItem, remediations: ReadonlyMap<string, ResolvedRemediation>): string {
  for (const id of item.remediationIds) {
    const remediation = remediations.get(id);
    if (remediation !== undefined) return remediation.title;
  }
  return t('tools.openDetailsHint');
}
