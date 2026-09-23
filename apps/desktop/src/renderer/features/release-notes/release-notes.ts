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
