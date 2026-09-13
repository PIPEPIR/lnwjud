import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlatformCapabilitySet } from './platform-capability-set.js';
import { LinuxSchedulerCapabilityBackend } from './linux-scheduler-backend.js';

afterEach(() => vi.restoreAllMocks());

describe('platform capability composition', () => {
  it('does not construct Windows providers for macOS/Linux profiles', async () => {
    const scheduler = vi.spyOn(LinuxSchedulerCapabilityBackend.prototype, 'execute').mockResolvedValue({
      ok: true, value: { available: false, ready: false, reason: 'scheduler_provider_unavailable' },
    });
    const runtime = createPlatformCapabilitySet({
      platform: 'linux',
      dataPath: '/tmp/lnwjud-data',
      workspaceRootsProvider: async () => ['/tmp/project'],
    });

    await expect(runtime.service.execute('wsl_exec', { operation: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: false, ready: false, reason: 'unsupported_platform', deliveryState: 'unsupported' },
    });
    await expect(runtime.service.execute('wsl_exec', { operation: 'run', executable: 'wsl.exe' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_PLATFORM' },
    });
    await expect(runtime.service.execute('input_event', { action: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: false, ready: false, reason: 'native_host_missing' },
    });
    await expect(runtime.service.execute('system_info', { action: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: true, ready: true, backend: 'node-system-info', platform: 'linux' },
    });
    await expect(runtime.health.execute({ operation: 'check_tool', tool: 'scheduler' })).resolves.toMatchObject({
      ok: true,
      value: { available: false, ready: false, reason: 'scheduler_provider_unavailable' },
    });
    expect(scheduler).toHaveBeenCalled();
  });

  it('composes macOS without leaking Windows providers and reports missing native-host dependencies truthfully', async () => {
    const runtime = createPlatformCapabilitySet({
      platform: 'darwin',
      dataPath: '/Users/test/Library/Application Support/lnwjud',
      workspaceRootsProvider: async () => ['/Users/test/project'],
    });

    await expect(runtime.service.execute('wsl_exec', { operation: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: false, ready: false, reason: 'unsupported_platform', deliveryState: 'unsupported' },
    });
    await expect(runtime.service.execute('input_event', { action: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: false, ready: false, reason: 'native_host_missing' },
    });
    await expect(runtime.service.execute('system_info', { action: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: true, ready: true, backend: 'node-system-info', platform: 'darwin' },
    });
  });


  it('falls back to Electron desktop capture when Linux native screen capture is unavailable', async () => {
    const fallback = {
      execute: vi.fn(async (input: unknown) => {
        const action = typeof input === 'object' && input !== null && 'action' in input ? (input as { action?: unknown }).action : undefined;
        return action === 'status'
          ? { ok: true as const, value: { available: true, ready: true, backend: 'electron-native' } }
          : { ok: true as const, value: { format: 'png', mime_type: 'image/png', data_base64: 'cG5n', width: 1920, height: 1080, origin_x: 0, origin_y: 0, scale_x: 1, scale_y: 1 } };
      }),
    };
    const runtime = createPlatformCapabilitySet({
      platform: 'linux',
      dataPath: '/tmp/lnwjud-data',
      workspaceRootsProvider: async () => ['/tmp/project'],
      shared: { vision: fallback },
    });

    await expect(runtime.service.execute('vision', { action: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: true, ready: true, backend: 'linux-native-or-electron-capture' },
    });
    await expect(runtime.service.execute('vision', { action: 'capture_display' })).resolves.toMatchObject({
      ok: true,
      value: { width: 1920, height: 1080 },
    });
    expect(fallback.execute).toHaveBeenCalled();
  });

  it('keeps Windows bridge composition explicit and injectable', () => {
    expect(() => createPlatformCapabilitySet({
      platform: 'win32',
      dataPath: 'C:\\lnwjud-data',
      workspaceRootsProvider: async () => ['C:\\project'],
    })).toThrow('integrity-bound bridge configuration');
  });

  it('fails closed for an unsupported host instead of constructing Linux adapters', async () => {
    const runtime = createPlatformCapabilitySet({
      platform: 'freebsd',
      dataPath: '/tmp/lnwjud-data',
      workspaceRootsProvider: async () => ['/tmp/project'],
    });

    await expect(runtime.service.execute('input_event', { action: 'status' })).resolves.toMatchObject({
      ok: true,
      value: { available: false, ready: false, reason: 'unsupported_platform' },
    });
    await expect(runtime.service.execute('scheduler', { action: 'list' })).resolves.toMatchObject({
      ok: true,
      value: { available: false, ready: false, reason: 'unsupported_platform' },
    });
  });
});
