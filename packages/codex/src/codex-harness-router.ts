import { spawn } from 'node:child_process';

export type CodexHarness = 'core' | 'full';

export interface CodexHarnessDecision {
  readonly harness: CodexHarness;
  readonly reason: string;
}

export interface CodexHarnessRouteInput {
  readonly cwd: string;
  readonly instruction: string;
}

export interface CodexHarnessRouterPort {
  decide(input: CodexHarnessRouteInput): Promise<CodexHarnessDecision>;
}

export interface LayaRouterConfig {
  readonly enabled: boolean;
  readonly pythonExecutable: string;
  readonly serviceCwd: string;
  readonly healthUrl: string;
  readonly decideUrl: string;
  readonly startupTimeoutMs: number;
  readonly decisionTimeoutMs: number;
  readonly idleSeconds: number;
}

export class LayaCodexHarnessRouter implements CodexHarnessRouterPort {
  private startup: Promise<boolean> | null = null;
  private readonly config: LayaRouterConfig;

  public constructor(config: Partial<LayaRouterConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? envFlag('LNWJUD_CODEX_LAYA_ENABLED'),
      pythonExecutable: config.pythonExecutable ?? process.env.LNWJUD_CODEX_LAYA_PYTHON?.trim() ?? '',
      serviceCwd: config.serviceCwd ?? process.env.LNWJUD_CODEX_LAYA_CWD?.trim() ?? '',
      healthUrl: config.healthUrl ?? process.env.LNWJUD_CODEX_LAYA_HEALTH_URL?.trim() ?? 'http://127.0.0.1:8765/health',
      decideUrl: config.decideUrl ?? process.env.LNWJUD_CODEX_LAYA_DECIDE_URL?.trim() ?? 'http://127.0.0.1:8765/decide',
      startupTimeoutMs: config.startupTimeoutMs ?? envPositiveInt('LNWJUD_CODEX_LAYA_STARTUP_TIMEOUT_MS', 180_000),
      decisionTimeoutMs: config.decisionTimeoutMs ?? envPositiveInt('LNWJUD_CODEX_LAYA_DECISION_TIMEOUT_MS', 2_000),
      idleSeconds: config.idleSeconds ?? envPositiveInt('LNWJUD_CODEX_LAYA_IDLE_SECONDS', 1_800),
    };
  }

  public async decide(input: CodexHarnessRouteInput): Promise<CodexHarnessDecision> {
    if (!this.config.enabled) return { harness: 'full', reason: 'laya_disabled' };

    try {
      const healthy = await this.ensureService();
      if (!healthy) return { harness: 'full', reason: 'laya_unavailable' };

      const response = await requestJson(this.config.decideUrl, {
        method: 'POST',
        body: JSON.stringify({ task: input.instruction }),
        timeoutMs: this.config.decisionTimeoutMs,
      });
      const selected = response.selected_harness;
      if (selected === 'core') return { harness: 'core', reason: stringValue(response.policy_reason, 'laya_core') };
      if (selected === 'full') return { harness: 'full', reason: stringValue(response.policy_reason, 'laya_full') };
      return { harness: 'full', reason: 'laya_invalid_response' };
    } catch {
      return { harness: 'full', reason: 'laya_error' };
    }
  }

  private async ensureService(): Promise<boolean> {
    if (await isHealthy(this.config.healthUrl)) return true;
    if (this.config.pythonExecutable.length === 0 || this.config.serviceCwd.length === 0) return false;

    this.startup ??= this.startService();
    try {
      return await this.startup;
    } finally {
      this.startup = null;
    }
  }

  private async startService(): Promise<boolean> {
    if (await isHealthy(this.config.healthUrl)) return true;

    try {
      const child = spawn(
        this.config.pythonExecutable,
        ['-m', 'agent_router.service', '--idle-seconds', String(this.config.idleSeconds)],
        {
          cwd: this.config.serviceCwd,
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        },
      );
      child.unref();
    } catch {
      return false;
    }

    const deadline = Date.now() + this.config.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (await isHealthy(this.config.healthUrl)) return true;
      await delay(250);
    }
    return false;
  }
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await requestJson(url, { method: 'GET', timeoutMs: 500 });
    return response.ok === true;
  } catch {
    return false;
  }
}

async function requestJson(
  url: string,
  options: { readonly method: 'GET' | 'POST'; readonly body?: string; readonly timeoutMs: number },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const request = options.body === undefined
      ? { method: options.method, signal: controller.signal }
      : { method: options.method, headers: { 'content-type': 'application/json' }, body: options.body, signal: controller.signal };
    const response = await fetch(url, request);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected JSON object');
    return value as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function envPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
