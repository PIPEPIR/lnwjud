import type { MessageKey } from '../../i18n/messages.js';

export interface ReleaseNoteItem {
  readonly id: string;
  readonly titleKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly badge?: 'new' | 'improved' | 'fixed';
  readonly tags?: readonly string[];
}

export interface ReleaseNoteCategory {
  readonly id: 'office' | 'safety' | 'experience';
  readonly titleKey: MessageKey;
  readonly items: readonly ReleaseNoteItem[];
}

export interface ReleaseNote {
  readonly version: string;
  readonly categories: readonly ReleaseNoteCategory[];
}

const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '5.6.2',
    categories: [
      {
        id: 'experience',
        titleKey: 'whatsNew.category.experience',
        items: [
          {
            id: 'context-economy-http',
            titleKey: 'whatsNew.562.contextEconomy.title',
            descriptionKey: 'whatsNew.562.contextEconomy.description',
            badge: 'fixed',
            tags: ['MCP', 'Context Economy', 'HTTP'],
          },
          {
            id: 'binary-context-filter',
            titleKey: 'whatsNew.562.binaryContext.title',
            descriptionKey: 'whatsNew.562.binaryContext.description',
            badge: 'fixed',
            tags: ['Context', 'binary', '.DS_Store'],
          },
          {
            id: 'tunnel-transition-lock',
            titleKey: 'whatsNew.562.tunnelBusy.title',
            descriptionKey: 'whatsNew.562.tunnelBusy.description',
            badge: 'fixed',
            tags: ['Secure Tunnel', 'Settings', 'UI'],
          },
          {
            id: 'scheduled-claim-binding',
            titleKey: 'whatsNew.562.claimBinding.title',
            descriptionKey: 'whatsNew.562.claimBinding.description',
            badge: 'fixed',
            tags: ['Scheduled Continuation', 'MCP'],
          },
        ],
      },
    ],
  },
  {
    version: '5.6.1',
    categories: [
      {
        id: 'experience',
        titleKey: 'whatsNew.category.experience',
        items: [
          {
            id: 'watcher-observability',
            titleKey: 'whatsNew.561.watcherObservability.title',
            descriptionKey: 'whatsNew.561.watcherObservability.description',
            badge: 'improved',
            tags: ['Watcher', 'agents', 'activity', 'Git'],
          },
          {
            id: 'watcher-multi-project',
            titleKey: 'whatsNew.561.watcherMultiProject.title',
            descriptionKey: 'whatsNew.561.watcherMultiProject.description',
            badge: 'new',
            tags: ['Watcher', 'projects', 'goals', 'parallel'],
          },
          {
            id: 'git-scroll',
            titleKey: 'whatsNew.561.gitScroll.title',
            descriptionKey: 'whatsNew.561.gitScroll.description',
            badge: 'fixed',
            tags: ['Git', 'scroll', 'diff', 'UI'],
          },
          {
            id: 'watcher-pairing-ui',
            titleKey: 'whatsNew.561.pairingUi.title',
            descriptionKey: 'whatsNew.561.pairingUi.description',
            badge: 'improved',
            tags: ['Watcher', 'pairing', 'token', 'UX'],
          },
          {
            id: 'settings-scroll',
            titleKey: 'whatsNew.561.settingsScroll.title',
            descriptionKey: 'whatsNew.561.settingsScroll.description',
            badge: 'fixed',
            tags: ['Settings', 'scroll', 'Remote MCP', 'UI'],
          },
        ],
      },
    ],
  },
  {
    version: '5.6.0',
    categories: [
      {
        id: 'experience',
        titleKey: 'whatsNew.category.experience',
        items: [
          {
            id: 'watcher-runtime',
            titleKey: 'whatsNew.560.watcher.title',
            descriptionKey: 'whatsNew.560.watcher.description',
            badge: 'new',
            tags: ['Watcher', 'realtime', 'WebSocket', 'mobile'],
          },
          {
            id: 'watcher-autostart',
            titleKey: 'whatsNew.560.autostart.title',
            descriptionKey: 'whatsNew.560.autostart.description',
            badge: 'new',
            tags: ['Watcher', 'startup', 'desktop'],
          },
          {
            id: 'watcher-live-sync',
            titleKey: 'whatsNew.560.liveSync.title',
            descriptionKey: 'whatsNew.560.liveSync.description',
            badge: 'fixed',
            tags: ['Watcher', 'WebSocket', 'auth', 'snapshot'],
          },
          {
            id: 'git-diff-scroll',
            titleKey: 'whatsNew.560.gitDiff.title',
            descriptionKey: 'whatsNew.560.gitDiff.description',
            badge: 'improved',
            tags: ['Git', 'diff', 'scroll', 'desktop'],
          },
        ],
      },
      {
        id: 'safety',
        titleKey: 'whatsNew.category.safety',
        items: [
          {
            id: 'watcher-readonly-auth',
            titleKey: 'whatsNew.560.security.title',
            descriptionKey: 'whatsNew.560.security.description',
            badge: 'new',
            tags: ['Watcher', 'read-only', 'token', 'pairing'],
          },
          {
            id: 'scheduled-continuation-recovery',
            titleKey: 'whatsNew.560.schedulerRecovery.title',
            descriptionKey: 'whatsNew.560.schedulerRecovery.description',
            badge: 'fixed',
            tags: ['Scheduled Tasks', 'durable goals', 'liveness', 'recovery'],
          },
        ],
      },
    ],
  },
  {
    version: '5.5.3',
    categories: [
      {
        id: 'safety',
        titleKey: 'whatsNew.category.safety',
        items: [
          {
            id: 'scheduled-connector-binding',
            titleKey: 'whatsNew.553.connector.title',
            descriptionKey: 'whatsNew.553.connector.description',
            badge: 'fixed',
            tags: ['Scheduled Tasks', 'MCP', 'connector', 'durable goals'],
          },
        ],
      },
    ],
  },
  {
    version: '5.5.2',
    categories: [
      {
        id: 'experience',
        titleKey: 'whatsNew.category.experience',
        items: [
          {
            id: 'mcp-continuation-lifecycle',
            titleKey: 'whatsNew.552.continuation.title',
            descriptionKey: 'whatsNew.552.continuation.description',
            badge: 'fixed',
            tags: ['MCP', 'Secure Tunnel', 'continuation', 'large files'],
          },
        ],
      },
    ],
  },
  {
    version: '5.5.1',
    categories: [
      {
        id: 'safety',
        titleKey: 'whatsNew.category.safety',
        items: [
          {
            id: 'mutation-ownership',
            titleKey: 'whatsNew.551.mutationOwnership.title',
            descriptionKey: 'whatsNew.551.mutationOwnership.description',
            badge: 'fixed',
            tags: ['durable-goals', 'mutation-safety', 'scheduler'],
          },
        ],
      },
      {
        id: 'experience',
        titleKey: 'whatsNew.category.experience',
        items: [
          {
            id: 'windows-startup',
            titleKey: 'whatsNew.551.windowsStartup.title',
            descriptionKey: 'whatsNew.551.windowsStartup.description',
            badge: 'fixed',
            tags: ['Windows 10', 'startup', 'ZIP'],
          },
          {
            id: 'scheduled-bundle-freshness',
            titleKey: 'whatsNew.551.scheduledBundle.title',
            descriptionKey: 'whatsNew.551.scheduledBundle.description',
            badge: 'fixed',
            tags: ['packaging', 'scheduled-tasks', 'durable-goals'],
          },
          {
            id: 'persistent-tunnel-reconnect',
            titleKey: 'whatsNew.551.tunnelReconnect.title',
            descriptionKey: 'whatsNew.551.tunnelReconnect.description',
            badge: 'fixed',
            tags: ['Tunnel', 'reconnect', 'Persistent Runtime'],
          },
          {
            id: 'modal-centering',
            titleKey: 'whatsNew.551.modalCentering.title',
            descriptionKey: 'whatsNew.551.modalCentering.description',
            badge: 'improved',
            tags: ['release-notes', 'accessibility', 'UI'],
          },
        ],
      },
    ],
  },
  {
    version: '5.5.0',
    categories: [
      {
        id: 'office',
        titleKey: 'whatsNew.category.office',
        items: [
          {
            id: 'office-semantic-suite',
            titleKey: 'whatsNew.550.officeSuite.title',
            descriptionKey: 'whatsNew.550.officeSuite.description',
            badge: 'new',
            tags: ['Office', 'Word', 'Excel', 'PowerPoint', 'Outlook'],
          },
          {
            id: 'office-readiness',
            titleKey: 'whatsNew.550.readiness.title',
            descriptionKey: 'whatsNew.550.readiness.description',
            badge: 'improved',
            tags: ['providers', 'readiness'],
          },
        ],
      },
      {
        id: 'safety',
        titleKey: 'whatsNew.category.safety',
        items: [
          {
            id: 'office-safety',
            titleKey: 'whatsNew.550.safety.title',
            descriptionKey: 'whatsNew.550.safety.description',
            badge: 'improved',
            tags: ['dry-run', 'recovery', 'permissions'],
          },
        ],
      },
      {
        id: 'experience',
        titleKey: 'whatsNew.category.experience',
        items: [
          {
            id: 'remote-mcp-transports',
            titleKey: 'whatsNew.550.remoteMcp.title',
            descriptionKey: 'whatsNew.550.remoteMcp.description',
            badge: 'new',
            tags: ['MCP', 'Cloudflare', 'ngrok', 'Local MCP'],
          },
          {
            id: 'tunnel-auto-start',
            titleKey: 'whatsNew.550.tunnelAutoStart.title',
            descriptionKey: 'whatsNew.550.tunnelAutoStart.description',
            badge: 'improved',
            tags: ['Tunnel', 'startup', 'reconnect'],
          },
          {
            id: 'scheduled-continuation',
            titleKey: 'whatsNew.550.scheduler.title',
            descriptionKey: 'whatsNew.550.scheduler.description',
            badge: 'fixed',
            tags: ['scheduled-tasks', 'durable-goals'],
          },
          {
            id: 'reconnect-result-recovery',
            titleKey: 'whatsNew.550.reconnectRecovery.title',
            descriptionKey: 'whatsNew.550.reconnectRecovery.description',
            badge: 'fixed',
            tags: ['reconnect', 'durable-goals', 'recovery'],
          },
          {
            id: 'search-edit-recovery',
            titleKey: 'whatsNew.550.searchEdit.title',
            descriptionKey: 'whatsNew.550.searchEdit.description',
            badge: 'fixed',
            tags: ['search', 'edit-file', 'recovery'],
          },
          {
            id: 'whats-new',
            titleKey: 'whatsNew.550.modal.title',
            descriptionKey: 'whatsNew.550.modal.description',
            badge: 'new',
            tags: ['release-notes', 'i18n'],
          },
        ],
      },
    ],
  },
];

export function releaseNotesForVersion(version: string): ReleaseNote | undefined {
  return RELEASE_NOTES.find((entry) => entry.version === version.trim());
}
