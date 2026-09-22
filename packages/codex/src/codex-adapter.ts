import { err, ok, type Result } from '@lnwjud/domain';
import { ProcessManager, type LogQuery, type ManagedProcess, type ManagedProcessStart, type ProcessLogResult } from '@lnwjud/process';
import { CodexDiscovery } from './codex-discovery.js';
import { CodexInvocationBuilder, type CodexDiscoveryResult, type CodexInvocation, type CodexSandboxMode, type CodexStatus } from './codex-capabilities.js';
import { LayaCodexHarnessRouter, type CodexHarnessRouterPort } from './codex-harness-router.js';

export interface CodexDiscoveryPort {
  discover(): Promise<Result<CodexDiscoveryResult>>;
}

export interface CodexProcessManagerPort {
  start(spec: ManagedProcessStart, signal?: AbortSignal, onCreated?: (process: ManagedProcess) => void): Promise<Result<ManagedProcess>>;
  status(processId: string): Result<ManagedProcess>;
  logs(processId: string, query: LogQuery): Result<ProcessLogResult>;
  stop(processId: string, autoRetry?: boolean): Promise<Result<void>>;
}

export interface CodexInvocationBuilderPort {
  build(executable: string, capabilities: CodexDiscoveryResult['capabilities'], instruction: string, sandboxMode?: CodexSandboxMode, profile?: string): Result<CodexInvocation>;
}

export class CodexAdapter {
  private readonly builder: CodexInvocationBuilderPort;
  private readonly harnessRouter: CodexHarnessRouterPort;

  public constructor(
    private readonly discovery: CodexDiscoveryPort = new CodexDiscovery(),
    private readonly processManager: CodexProcessManagerPort = new ProcessManager(),
    builder: CodexInvocationBuilderPort = new CodexInvocationBuilder(),
    harnessRouter: CodexHarnessRouterPort = new LayaCodexHarnessRouter(),
  ) {
    this.builder = builder;
    this.harnessRouter = harnessRouter;
  }

  public async status(): Promise<Result<CodexStatus>> {
    const discovered = await this.discovery.discover();
    return discovered.ok ? ok(discovered.value.status) : discovered;
  }

  public async start(
    cwd: string,
    instruction: string,
    signal?: AbortSignal,
    onCreated?: (process: ManagedProcess) => void,
    sandboxMode: CodexSandboxMode = 'workspace-write',
  ): Promise<Result<ManagedProcess>> {
    if (isAborted(signal)) return cancelledCodexStart();
    const discovered = await this.discovery.discover();
    if (isAborted(signal)) return cancelledCodexStart();
    if (!discovered.ok) return discovered;
    if (!discovered.value.status.installed || discovered.value.status.executablePath === undefined) {
      return err({ code: 'CODEX_NOT_AVAILABLE', message: 'Codex is not installed', recoverable: true });
    }
    const harness = await safeHarnessDecision(this.harnessRouter, { cwd, instruction });
    const profile = harness === 'core' ? coreProfileName() : undefined;
    const invocation = this.builder.build(discovered.value.status.executablePath, discovered.value.capabilities, instruction, sandboxMode, profile);
    if (!invocation.ok) return invocation;
    if (isAborted(signal)) return cancelledCodexStart();
    return this.processManager.start({ executable: invocation.value.executable, args: invocation.value.args, cwd }, signal, onCreated);
  }

  public statusProcess(processId: string): Result<ManagedProcess> {
    return this.processManager.status(processId);
  }

  public logs(processId: string, query: LogQuery): Result<ProcessLogResult> {
    return this.processManager.logs(processId, query);
  }

  public stop(processId: string, autoRetry = false): Promise<Result<void>> {
    return this.processManager.stop(processId, autoRetry);
  }
}

async function safeHarnessDecision(router: CodexHarnessRouterPort, input: { readonly cwd: string; readonly instruction: string }): Promise<'core' | 'full'> {
  try {
    const decision = await router.decide(input);
    return decision.harness === 'core' ? 'core' : 'full';
  } catch {
    return 'full';
  }
}

function coreProfileName(): string {
  return process.env.LNWJUD_CODEX_CORE_PROFILE?.trim() || 'core';
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function cancelledCodexStart(): Result<never> {
  return err({ code: 'PROCESS_TIMEOUT', message: 'Codex start was cancelled before launch completed', recoverable: true });
}
