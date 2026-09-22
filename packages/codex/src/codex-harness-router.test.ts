import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayaCodexHarnessRouter } from './codex-harness-router.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('LayaCodexHarnessRouter', () => {
  it('uses full Codex when native Laya routing is disabled', async () => {
    const router = new LayaCodexHarnessRouter({ enabled: false });
    await expect(router.decide({ cwd: 'C:\\workspace', instruction: 'fix local bug' })).resolves.toEqual({
      harness: 'full',
      reason: 'laya_disabled',
    });
  });

  it('uses full Codex when Laya is unavailable and no service command is configured', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as typeof fetch;
    const router = new LayaCodexHarnessRouter({
      enabled: true,
      pythonExecutable: '',
      serviceCwd: '',
      startupTimeoutMs: 10,
      decisionTimeoutMs: 10,
    });

    await expect(router.decide({ cwd: 'C:\\workspace', instruction: 'fix local bug' })).resolves.toEqual({
      harness: 'full',
      reason: 'laya_unavailable',
    });
  });

  it('returns the core harness selected by a healthy Laya service', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        selected_harness: 'core',
        policy_reason: 'local_self_contained',
      }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const router = new LayaCodexHarnessRouter({
      enabled: true,
      decisionTimeoutMs: 100,
    });

    await expect(router.decide({ cwd: 'C:\\workspace', instruction: 'fix local bug' })).resolves.toEqual({
      harness: 'core',
      reason: 'local_self_contained',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed to full on an invalid decision payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ selected_harness: 'something_else' }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const router = new LayaCodexHarnessRouter({ enabled: true });

    await expect(router.decide({ cwd: 'C:\\workspace', instruction: 'fix local bug' })).resolves.toEqual({
      harness: 'full',
      reason: 'laya_invalid_response',
    });
  });
});
