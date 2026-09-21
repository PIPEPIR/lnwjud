import { describe, expect, it } from 'vitest';

import { DEFAULT_RECOVERY_RETENTION_DAYS, parseIntegerSetting, parseMcpAllowedHostnames } from './user-settings.js';

describe('MCP Host allow-list settings', () => {
  it('keeps only explicit hostname values and rejects URLs, ports, and wildcards', () => {
    expect(parseMcpAllowedHostnames('Example.Ngrok-Free.Dev;example.ngrok-free.dev;https://evil.example;evil.example:443;*.example.com;[::1]'))
      .toEqual(['example.ngrok-free.dev', '[::1]']);
  });
});

describe('recovery retention defaults', () => {
  it('uses 30 days only when retention has never been configured', () => {
    const missingStoredValue: string | null = null;
    expect(parseIntegerSetting(missingStoredValue ?? undefined, DEFAULT_RECOVERY_RETENTION_DAYS, 0, 3650)).toBe(30);
    expect(parseIntegerSetting('0', DEFAULT_RECOVERY_RETENTION_DAYS, 0, 3650)).toBe(0);
    expect(parseIntegerSetting('90', DEFAULT_RECOVERY_RETENTION_DAYS, 0, 3650)).toBe(90);
  });
});
