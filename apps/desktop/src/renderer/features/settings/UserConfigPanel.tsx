import { useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  ExtraMcpServerSettings,
  PermissionDecisionSetting,
  PermissionProfileName,
  PdfProviderInstallResult,
  UiLocale,
  UserSettings,
} from '@lnwjud/ipc-contracts';
import { parseDelimitedList } from '@lnwjud/shared/text-list';
import { createTranslator } from '../../i18n/index.js';
import { SettingsCardHeading, StatusMessage, EmptyState } from '../ui/UiPrimitives.js';
import { SettingSwitch } from './SettingSwitch.js';

export type UserConfigSection = 'general' | 'security' | 'tools' | 'mcp' | 'tunnel';

interface UserConfigPanelProps {
  readonly locale: UiLocale;
  readonly hostPlatform: 'win32' | 'darwin' | 'linux';
  readonly hostArch: 'x64' | 'arm64';
  readonly permissionProfile: PermissionProfileName;
  readonly stdioPermissionProfile: PermissionProfileName;
  readonly settings?: UserSettings;
  readonly section: UserConfigSection | null;
  readonly unrestricted: boolean;
  readonly onUnrestrictedChange: (enabled: boolean) => Promise<boolean>;
  readonly onSave: (settings: UserSettings) => Promise<boolean>;
  readonly onInstallPdfProvider: () => Promise<PdfProviderInstallResult>;
  readonly embedded?: boolean;
}

const DEFAULT_USER_SETTINGS: UserSettings = {
  customPermission: { read: 'ALLOW', write: 'ASK', execute: 'ASK', dangerous: 'DENY', allowedExecutables: [] },
  desktopFullBypassAll: false,
  stdioFullBypassAll: false,
  mcpCallTimeoutMs: 60_000,
  mcpIdleTimeoutMs: 5 * 60_000,
  processTimeoutMs: 60 * 60_000,
  mcpPollWaitSeconds: 5,
  shellSynchronousWaitSeconds: 60,
  capabilityRoots: [],
  pdfProviderPath: '',
  lspCommands: {},
  mcpHttpPort: 18_765,
  codexToolsEnabled: false,
  ponytailMode: 'off',
  updateAutoCheck: true,
  updateCheckOnStartup: true,
  updateIntervalMinutes: 30,
  updateAutoDownload: true,
  closeBehavior: 'tray',
  launchAtStartup: false,
  startMinimized: false,
  tunnelAutoReconnect: true,
  tunnelMaxAutoRestarts: 5,
  recoveryRetentionDays: 30,
  extensions: { mode: 'enable_all', disabledServers: [], enabledServers: [], disabledSkillRoots: [], extraSkillRoots: [], extraMcpServers: [] },
};

export function UserConfigPanel({ locale, hostPlatform, hostArch, permissionProfile, stdioPermissionProfile, settings, section, unrestricted, onUnrestrictedChange, onSave, onInstallPdfProvider, embedded = false }: UserConfigPanelProps): ReactElement {
  const t = createTranslator(locale);
  const effectiveSettings = settings ?? DEFAULT_USER_SETTINGS;
  const persistedSettingsFingerprint = JSON.stringify(effectiveSettings);
  const isWindowsHost = hostPlatform === 'win32';
  const canAutoInstallPdfProvider = isWindowsHost && hostArch === 'x64';
  const [draft, setDraft] = useState<UserSettings>(effectiveSettings);
  const lastPersistedSettingsFingerprint = useRef(persistedSettingsFingerprint);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfInstallBusy, setPdfInstallBusy] = useState(false);
  const [pdfInstallMessage, setPdfInstallMessage] = useState<string | null>(null);
  const [pdfInstallError, setPdfInstallError] = useState<string | null>(null);
  const [unrestrictedMessage, setUnrestrictedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (dirty || persistedSettingsFingerprint === lastPersistedSettingsFingerprint.current) return;
    lastPersistedSettingsFingerprint.current = persistedSettingsFingerprint;
    setDraft(effectiveSettings);
  }, [dirty, effectiveSettings, persistedSettingsFingerprint]);

  function patch(next: Partial<UserSettings>): void {
    setDraft((previous) => ({ ...previous, ...next }));
    markDirty();
  }

  function patchCustom(next: Partial<UserSettings['customPermission']>): void {
    setDraft((previous) => ({ ...previous, customPermission: { ...previous.customPermission, ...next } }));
    markDirty();
  }

  function patchExtensions(next: Partial<UserSettings['extensions']>): void {
    setDraft((previous) => ({ ...previous, extensions: { ...previous.extensions, ...next } }));
    markDirty();
  }

  function markDirty(): void {
    setDirty(true);
    setMessage(null);
    setError(null);
  }

  function changeFullBypass(target: 'desktop' | 'stdio', enabled: boolean): void {
    if (enabled) {
      const confirmed = window.confirm(t('userConfig.fullBypassConfirm'));
      if (!confirmed) return;
    }
    patch(target === 'desktop' ? { desktopFullBypassAll: enabled } : { stdioFullBypassAll: enabled });
  }

  function updateServer(index: number, next: Partial<ExtraMcpServerSettings>): void {
    patchExtensions({
      extraMcpServers: draft.extensions.extraMcpServers.map((server, current) => current === index ? { ...server, ...next } : server),
    });
  }

  function addServer(): void {
    const used = new Set(draft.extensions.extraMcpServers.map((server) => server.name.toLowerCase()));
    let sequence = draft.extensions.extraMcpServers.length + 1;
    while (used.has(`mcp-server-${sequence}`)) sequence += 1;
    patchExtensions({
      extraMcpServers: [...draft.extensions.extraMcpServers, {
        name: `mcp-server-${sequence}`,
        command: '',
        args: [],
        cwd: '',
        type: '',
        env: {},
      }],
    });
  }

  async function installPdf(): Promise<void> {
    if (pdfInstallBusy) return;
    setPdfInstallBusy(true);
    setPdfInstallMessage(null);
    setPdfInstallError(null);
    try {
      const result = await onInstallPdfProvider();
      setDraft((previous) => ({ ...previous, pdfProviderPath: result.providerPath }));
      setPdfInstallMessage(result.reused
        ? t('userConfig.pdfReady', { path: result.providerPath })
        : t('userConfig.pdfInstalled', { version: result.version }));
    } catch (cause: unknown) {
      setPdfInstallError(cause instanceof Error ? cause.message : t('userConfig.pdfInstallError'));
    } finally {
      setPdfInstallBusy(false);
    }
  }

  async function save(): Promise<void> {
    const invalid = draft.extensions.extraMcpServers.find((server) => server.name.trim().length === 0 || server.command.trim().length === 0);
    if (invalid !== undefined) {
      setError(t('userConfig.customServerRequired'));
      return;
    }
    const names = draft.extensions.extraMcpServers.map((server) => server.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      setError(t('userConfig.customServerUnique'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const restartRequired = await onSave(draft);
      setDirty(false);
      setMessage(restartRequired ? t('userConfig.savedReconnect') : t('userConfig.saved'));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('userConfig.saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {section === 'general' ? (
        <section className="panel settings-card settings-card-polished" aria-label={t('userConfig.applicationBehavior')}>
          <SettingsCardHeading icon="⚙" title={t('userConfig.applicationBehavior')} subtitle={t('userConfig.applicationBehaviorSubtitle')} />
          <div className="setting-grid two-col">
            <div className="setting-field">
              <label className="field-label" htmlFor="close-behavior">{t('userConfig.closeBehavior')}</label>
              <select id="close-behavior" className="settings-select" value={draft.closeBehavior} onChange={(event) => patch({ closeBehavior: event.target.value === 'quit' ? 'quit' : 'tray' })}>
                <option value="tray">{t('userConfig.hideToTray')}</option>
                <option value="quit">{t('userConfig.quit')}</option>
              </select>
            </div>
            <NumberField label={t('userConfig.updateInterval')} value={draft.updateIntervalMinutes} min={5} max={1440} onChange={(value) => patch({ updateIntervalMinutes: value })} />
          </div>
          <div className="switch-grid">
            <SettingSwitch checked={draft.launchAtStartup} label={t('userConfig.launchAtStartup')} description={t('userConfig.launchAtStartupDesc')} onChange={(value) => patch({ launchAtStartup: value })} />
            <SettingSwitch checked={draft.startMinimized} label={t('userConfig.startMinimized')} description={t('userConfig.startMinimizedDesc')} onChange={(value) => patch({ startMinimized: value })} />
            <SettingSwitch checked={draft.updateAutoCheck} label={t('userConfig.autoUpdateCheck')} description={t('userConfig.autoUpdateCheckDesc')} onChange={(value) => patch({ updateAutoCheck: value })} />
            <SettingSwitch checked={draft.updateCheckOnStartup} label={t('userConfig.checkOnStartup')} description={t('userConfig.checkOnStartupDesc')} onChange={(value) => patch({ updateCheckOnStartup: value })} />
            <SettingSwitch checked={draft.updateAutoDownload} label={t('userConfig.autoDownload')} description={t('userConfig.autoDownloadDesc')} onChange={(value) => patch({ updateAutoDownload: value })} />
          </div>
        </section>
      ) : null}

      {section === 'security' ? (
        <>
          <section className="panel settings-card settings-card-polished full-access-unrestricted-card" aria-label={t('userConfig.fullAccessCardAria')}>
            <SettingsCardHeading
              icon="⚡"
              title={t('userConfig.advancedAccessTitle')}
              subtitle={t('userConfig.advancedAccessSubtitle')}
              badge={((permissionProfile === 'full' && draft.desktopFullBypassAll) || (stdioPermissionProfile === 'full' && draft.stdioFullBypassAll)) ? t('userConfig.fullBypassBadgeOn') : unrestricted ? t('userConfig.unrestrictedBadge') : t('userConfig.offBadge')}
            />
            <SettingSwitch
              checked={unrestricted}
              label={t('userConfig.unrestrictedLabel')}
              description={t('userConfig.unrestrictedDesc')}
              onChange={(enabled) => { void onUnrestrictedChange(enabled).then((restartRequired) => setUnrestrictedMessage(restartRequired ? t('userConfig.unrestrictedSavedRestart') : null)); }}
            />
            {unrestrictedMessage === null ? null : <StatusMessage tone="warning" prefix="⚠️ ">{unrestrictedMessage}</StatusMessage>}
            {permissionProfile === 'full' ? (
              <div className="alert-box-warning full-bypass-control" role="group" aria-label={t('userConfig.desktopBypassGroup')}>
                <strong>{draft.desktopFullBypassAll ? t('userConfig.desktopBypassOn') : t('userConfig.desktopBypassOff')}</strong>
                <SettingSwitch
                  checked={draft.desktopFullBypassAll}
                  label={t('userConfig.desktopBypassLabel')}
                  description={t('userConfig.desktopBypassDesc')}
                  onChange={(value) => changeFullBypass('desktop', value)}
                />
              </div>
            ) : <p className="hint">{t('userConfig.desktopBypassNeedFull')}</p>}
            {stdioPermissionProfile === 'full' ? (
              <div className="alert-box-warning full-bypass-control" role="group" aria-label={t('userConfig.stdioBypassGroup')}>
                <strong>{draft.stdioFullBypassAll ? t('userConfig.stdioBypassOn') : t('userConfig.stdioBypassOff')}</strong>
                <SettingSwitch
                  checked={draft.stdioFullBypassAll}
                  label={t('userConfig.stdioBypassLabel')}
                  description={t('userConfig.stdioBypassDesc')}
                  onChange={(value) => changeFullBypass('stdio', value)}
                />
              </div>
            ) : <p className="hint">{t('userConfig.stdioBypassNeedFull')}</p>}
            <p className="hint">{t('userConfig.fullBypassOffHint')}</p>
            <p className="hint">{t('userConfig.fullBypassOnHint')}</p>
          </section>

          <section className="panel settings-card settings-card-polished custom-permission-card" aria-label={t('userConfig.customPermissionTitle')}>
            <SettingsCardHeading icon="◇" title={t('userConfig.customPermissionTitle')} subtitle={t('userConfig.customPermissionSubtitle')} badge="CUSTOM" />
            <div className="setting-grid four-col">
              <Decision label="READ" value={draft.customPermission.read} onChange={(value) => patchCustom({ read: value })} />
              <Decision label="WRITE" value={draft.customPermission.write} onChange={(value) => patchCustom({ write: value })} />
              <Decision label="EXECUTE" value={draft.customPermission.execute} onChange={(value) => patchCustom({ execute: value })} />
              <Decision label="DANGEROUS" value={draft.customPermission.dangerous} onChange={(value) => patchCustom({ dangerous: value })} />
            </div>
            <TextList
              id="custom-executables"
              label={t('userConfig.allowedExecutables')}
              value={draft.customPermission.allowedExecutables}
              rows={4}
              placeholder={isWindowsHost ? 'python.exe\ndocker.exe\ndotnet.exe' : 'python\ndocker\ndotnet'}
              onChange={(value) => patchCustom({ allowedExecutables: value })}
            />
          </section>
        </>
      ) : null}

      {section === 'tools' ? (
        <>
          <section className="panel settings-card settings-card-polished" aria-label={t('userConfig.codexTitle')} data-settings-focus="tools-codex" tabIndex={-1}>
            <SettingsCardHeading icon="◎" title={t('userConfig.codexTitle')} subtitle={t('userConfig.codexSubtitle')} badge={draft.codexToolsEnabled ? t('status.enabled') : t('status.defaultOff')} />
            <SettingSwitch
              checked={draft.codexToolsEnabled}
              label={t('userConfig.codexLabel')}
              description={t('userConfig.codexDesc')}
              onChange={(value) => patch({ codexToolsEnabled: value })}
            />
            <div className="codex-tool-preview" aria-label={t('userConfig.codexToolExposure')}>
              <span>codex_run</span><span>codex_status</span><span>codex_stop</span><span>codex_task_*</span>
            </div>
            <p className="hint">{t('userConfig.codexRestartHint')}</p>
          </section>

          <section className="panel settings-card settings-card-polished" aria-label={t('userConfig.timeoutsTitle')}>
            <SettingsCardHeading icon="⌛" title={t('userConfig.timeoutsTitle')} subtitle={t('userConfig.timeoutsSubtitle')} />
            <div className="setting-grid two-col">
              <NumberField label={t('userConfig.mcpToolTimeout')} value={Math.round(draft.mcpCallTimeoutMs / 1000)} min={1} max={3600} onChange={(value) => patch({ mcpCallTimeoutMs: value * 1000 })} />
              <NumberField label={t('userConfig.mcpIdleTimeout')} value={Math.round(draft.mcpIdleTimeoutMs / 60_000)} min={1} max={1440} onChange={(value) => patch({ mcpIdleTimeoutMs: value * 60_000 })} />
              <NumberField label={t('userConfig.processTimeout')} value={Math.round(draft.processTimeoutMs / 60_000)} min={1} max={240} onChange={(value) => patch({ processTimeoutMs: value * 60_000 })} />
              <NumberField label={t('userConfig.mcpPollWait')} value={draft.mcpPollWaitSeconds} min={5} max={60} onChange={(value) => patch({ mcpPollWaitSeconds: value })} />
              <NumberField label={t('userConfig.shellWait')} value={draft.shellSynchronousWaitSeconds} min={5} max={60} onChange={(value) => patch({ shellSynchronousWaitSeconds: value })} />
              <NumberField label={t('userConfig.localMcpHttpPort')} value={draft.mcpHttpPort} min={0} max={65535} onChange={(value) => patch({ mcpHttpPort: value })} />
            </div>
            <p className="hint">{t('userConfig.waitRangeHint')}</p>
          </section>

          <section className="panel settings-card settings-card-polished" aria-label={t('userConfig.capabilityRootsTitle')}>
            <SettingsCardHeading icon="⌂" title={t('userConfig.capabilityRootsTitle')} subtitle={t('userConfig.capabilityRootsSubtitle')} />
            <TextList
              id="capability-roots"
              label={t('userConfig.onePathPerLine')}
              value={draft.capabilityRoots}
              rows={5}
              placeholder={isWindowsHost ? 'D:\\Projects\nE:\\Work' : '/Users/name/Projects\n/home/name/Work'}
              onChange={(value) => patch({ capabilityRoots: value })}
            />
            <p className="hint">{t('userConfig.capabilityRootsHint')}</p>
          </section>

          <section className="panel settings-card settings-card-polished" aria-label={t('userConfig.localProvidersTitle')} data-settings-focus="tools-local-providers" tabIndex={-1}>
            <SettingsCardHeading icon="◫" title={t('userConfig.localProvidersTitle')} subtitle={t('userConfig.localProvidersSubtitle')} badge={t('status.advanced')} />
            <div className="setting-grid two-col">
              <div className="pdf-provider-install-control">
                <Field
                  label={t('userConfig.pdfProviderLabel', { binary: isWindowsHost ? 'pdftotext.exe' : 'pdftotext' })}
                  value={draft.pdfProviderPath}
                  placeholder={t('userConfig.pdfProviderPlaceholder', { binary: isWindowsHost ? 'pdftotext.exe' : 'pdftotext' })}
                  onChange={(value) => patch({ pdfProviderPath: value })}
                />
                {canAutoInstallPdfProvider ? (
                  <div className="inline-actions">
                    <button type="button" className="btn-save-gold" disabled={pdfInstallBusy} onClick={() => { void installPdf(); }}>
                      {pdfInstallBusy ? t('userConfig.pdfInstalling') : t('userConfig.pdfAutoInstall')}
                    </button>
                  </div>
                ) : null}
                <p className="hint">{canAutoInstallPdfProvider ? t('userConfig.pdfAutoInstallHint') : t('userConfig.pdfManualInstallHint', { platform: hostPlatform, arch: hostArch })}</p>
                {pdfInstallError === null ? null : <StatusMessage tone="warning" role="alert" prefix="⚠️ ">{pdfInstallError}</StatusMessage>}
                {pdfInstallMessage === null ? null : <StatusMessage tone="success" prefix="✓ ">{pdfInstallMessage}</StatusMessage>}
              </div>
              <StringMapTextArea
                label={t('userConfig.lspCommands')}
                value={draft.lspCommands}
                onChange={(value) => patch({ lspCommands: value })}
              />
            </div>
            <p className="hint">{t('userConfig.lspHint')}</p>
          </section>
        </>
      ) : null}

      {section === 'mcp' ? (
        <section className="panel settings-card settings-card-polished" aria-label={t('userConfig.extensionsTitle')} data-settings-focus="mcp-servers" tabIndex={-1}>
          <SettingsCardHeading
            icon="⬡"
            title={t('userConfig.extensionsTitle')}
            subtitle={t('userConfig.extensionsSubtitle')}
            action={<button type="button" className="btn-save-gold" onClick={addServer}>+ {t('userConfig.addMcpServer')}</button>}
          />
          <div className="setting-grid two-col">
            <div className="setting-field">
              <label className="field-label" htmlFor="extension-mode">{t('userConfig.extensionMode')}</label>
              <select id="extension-mode" className="settings-select" value={draft.extensions.mode} onChange={(event) => patchExtensions({ mode: event.target.value === 'allowlist' ? 'allowlist' : 'enable_all' })}>
                <option value="enable_all">{t('userConfig.enableAllExceptDisabled')}</option>
                <option value="allowlist">{t('userConfig.allowlistOnly')}</option>
              </select>
            </div>
            <TextList label={t('userConfig.enabledServersAllowlist')} value={draft.extensions.enabledServers} onChange={(value) => patchExtensions({ enabledServers: value })} />
            <TextList label={t('userConfig.disabledServers')} value={draft.extensions.disabledServers} onChange={(value) => patchExtensions({ disabledServers: value })} />
            <TextList label={t('userConfig.extraSkillFolders')} value={draft.extensions.extraSkillRoots} onChange={(value) => patchExtensions({ extraSkillRoots: value })} />
            <TextList label={t('userConfig.disabledSkillFolders')} value={draft.extensions.disabledSkillRoots} onChange={(value) => patchExtensions({ disabledSkillRoots: value })} />
          </div>
          <div className="mcp-server-settings-list">
            {draft.extensions.extraMcpServers.length === 0 ? <EmptyState>{t('userConfig.noCustomMcp')}</EmptyState> : null}
            {draft.extensions.extraMcpServers.map((server, index) => (
              <article className="mcp-server-settings-item" key={`${server.name}-${index}`}>
                <div className="section-heading"><strong>{server.name || t('userConfig.mcpServerNumber', { number: index + 1 })}</strong><button type="button" className="danger-soft-button" onClick={() => patchExtensions({ extraMcpServers: draft.extensions.extraMcpServers.filter((_entry, current) => current !== index) })}>{t('userConfig.remove')}</button></div>
                <div className="setting-grid two-col">
                  <Field label={t('userConfig.serverName')} value={server.name} onChange={(value) => updateServer(index, { name: value })} />
                  <Field label={t('userConfig.serverCommand')} value={server.command} placeholder="npx" onChange={(value) => updateServer(index, { command: value })} />
                  <Field label={t('userConfig.serverWorkingDirectory')} value={server.cwd} placeholder={t('userConfig.optional')} onChange={(value) => updateServer(index, { cwd: value })} />
                  <Field label={t('userConfig.serverType')} value={server.type} placeholder={t('userConfig.optionalStdio')} onChange={(value) => updateServer(index, { type: value })} />
                  <TextArea label={t('userConfig.serverArgs')} value={server.args.join('\n')} onChange={(value) => updateServer(index, { args: splitLines(value) })} />
                  <TextArea label={t('userConfig.serverEnvironment')} value={envToText(server.env)} onChange={(value) => updateServer(index, { env: envFromText(value) })} />
                </div>
              </article>
            ))}
          </div>
          <p className="hint">{t('userConfig.mcpEnvHint')}</p>
        </section>
      ) : null}

      {section === 'tunnel' ? (
        <section className={embedded ? 'tunnel-setup-box persistent-runtime-card' : 'panel settings-card settings-card-polished'} aria-label={t('userConfig.persistentTunnelTitle')}>
          {embedded
            ? <div className="settings-mini-heading"><strong>{t('userConfig.persistentTunnelTitle')}</strong><span>{draft.tunnelAutoReconnect ? t('status.on') : t('status.off')}</span></div>
            : <SettingsCardHeading icon="↻" title={t('userConfig.persistentTunnelTitle')} subtitle={t('userConfig.persistentTunnelSubtitle')} badge={draft.tunnelAutoReconnect ? t('status.on') : t('status.off')} />}
          <SettingSwitch checked={draft.tunnelAutoReconnect} label={t('userConfig.autoReconnect')} description={t('userConfig.autoReconnectDesc')} onChange={(value) => patch({ tunnelAutoReconnect: value })} />
          <p className="hint">{t('userConfig.persistentIdentityHint')}</p>
        </section>
      ) : null}

      {section === null ? null : (
        <div className={`settings-save-bar ${dirty ? 'is-dirty' : ''}`}>
          <div>
            {error === null ? null : <StatusMessage tone="warning" role="alert" prefix="⚠️ ">{error}</StatusMessage>}
            {message === null ? <span className="save-state-copy">{dirty ? t('userConfig.unsavedChanges') : t('userConfig.allSaved')}</span> : <StatusMessage tone="success" prefix="✓ ">{message}</StatusMessage>}
          </div>
          <div className="inline-actions">
            <button type="button" disabled={!dirty || busy} onClick={() => { setDraft(effectiveSettings); setDirty(false); setError(null); setMessage(null); }}>{t('userConfig.discard')}</button>
            <button type="button" className="btn-save-gold" disabled={!dirty || busy} onClick={() => { void save(); }}>{busy ? t('userConfig.saving') : t('userConfig.saveChanges')}</button>
          </div>
        </div>
      )}
    </>
  );
}

function NumberField({ label, value, min, max, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly onChange: (value: number) => void }): ReactElement {
  return <div className="setting-field"><label className="field-label">{label}</label><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(clampNumber(event.target.value, value, min, max))} /></div>;
}

function Decision({ label, value, onChange }: { readonly label: string; readonly value: PermissionDecisionSetting; readonly onChange: (value: PermissionDecisionSetting) => void }): ReactElement {
  return <div className="setting-field"><label className="field-label">{label}</label><select className="settings-select" value={value} onChange={(event) => onChange(event.target.value === 'ALLOW' || event.target.value === 'DENY' ? event.target.value : 'ASK')}><option value="ALLOW">ALLOW</option><option value="ASK">ASK</option><option value="DENY">DENY</option></select></div>;
}

function TextList({ label, value, onChange, id, rows = 3, placeholder }: { readonly label: string; readonly value: readonly string[]; readonly onChange: (value: readonly string[]) => void; readonly id?: string; readonly rows?: number; readonly placeholder?: string }): ReactElement {
  const canonicalText = value.join('\n');
  const [draftText, setDraftText] = useState(canonicalText);

  useEffect(() => {
    if (!sameStringList(parseDelimitedList(draftText), value)) setDraftText(canonicalText);
  }, [canonicalText, draftText, value]);

  return (
    <div className="setting-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="settings-textarea"
        rows={rows}
        value={draftText}
        placeholder={placeholder}
        onChange={(event) => {
          const text = event.target.value;
          setDraftText(text);
          onChange(parseDelimitedList(text));
        }}
      />
    </div>
  );
}

function StringMapTextArea({ label, value, onChange }: { readonly label: string; readonly value: Readonly<Record<string, string>>; readonly onChange: (value: Readonly<Record<string, string>>) => void }): ReactElement {
  const canonicalText = stringMapToText(value);
  const [draftText, setDraftText] = useState(canonicalText);

  useEffect(() => {
    if (!sameStringMap(stringMapFromText(draftText), value)) setDraftText(canonicalText);
  }, [canonicalText, draftText, value]);

  return (
    <TextArea
      label={label}
      value={draftText}
      onChange={(text) => {
        setDraftText(text);
        onChange(stringMapFromText(text));
      }}
    />
  );
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameStringMap(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value], index) => key === rightEntries[index]?.[0] && value === rightEntries[index]?.[1]);
}

function Field({ label, value, placeholder, onChange }: { readonly label: string; readonly value: string; readonly placeholder?: string; readonly onChange: (value: string) => void }): ReactElement {
  return <div className="setting-field"><label className="field-label">{label}</label><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

function TextArea({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }): ReactElement {
  return <div className="setting-field"><label className="field-label">{label}</label><textarea className="settings-textarea" rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function splitLines(value: string): readonly string[] {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function stringMapFromText(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const entry = line.slice(separator + 1).trim();
    if (key.length > 0 && entry.length > 0) result[key] = entry;
  }
  return result;
}

function stringMapToText(value: Readonly<Record<string, string>>): string {
  return Object.entries(value).map(([key, entry]) => `${key}=${entry}`).join('\n');
}

function envFromText(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (key.length > 0) result[key] = line.slice(separator + 1);
  }
  return result;
}

function envToText(value: Readonly<Record<string, string>>): string {
  return Object.entries(value).map(([key, entry]) => `${key}=${entry}`).join('\n');
}

function clampNumber(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
