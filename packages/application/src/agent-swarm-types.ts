import type { AgentSwarmState, AgentSwarmTaskState } from '@lnwjud/domain';

export type { AgentSwarmState, AgentSwarmTaskState } from '@lnwjud/domain';

export type AgentSwarmExecutionStrategy = 'auto' | 'serial' | 'parallel';
export type AgentSwarmTaskComplexity = 'tiny' | 'normal' | 'large';
export type AgentSwarmExecutionMode = 'serial' | 'parallel' | 'mixed';

export interface AgentSwarmTaskRequest {
  readonly id: string;
  readonly prompt: string;
  readonly dependsOn?: readonly string[];
  /**
   * Planner-visible resources that must not be mutated concurrently by two tasks.
   * GPT may use file paths, package names, migration ids, or another stable resource key.
   */
  readonly collisionKeys?: readonly string[];
  /**
   * Tiny batches are intentionally kept serial in auto mode because process/orchestration
   * overhead can exceed the useful parallel work.
   */
  readonly complexity?: AgentSwarmTaskComplexity;
  /**
   * Set false for a task that must run as an exclusive barrier even when it has no
   * explicit dependency edge.
   */
  readonly parallelSafe?: boolean;
}

export interface AgentSwarmStartRequest {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly accessMode: 'read_only';
  readonly tasks: readonly AgentSwarmTaskRequest[];
  readonly maxConcurrency?: number;
  readonly executionStrategy?: AgentSwarmExecutionStrategy;
}

export interface AgentSwarmExecutionDecision {
  readonly mode: AgentSwarmExecutionMode;
  readonly maxConcurrency: number;
  readonly dependencyEdges: number;
  readonly reasonCodes: readonly string[];
}

export interface AgentSwarmTaskSnapshot {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly state: AgentSwarmTaskState;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly resultAvailable: boolean;
  readonly outputTruncated: boolean;
  readonly error?: string;
}

export interface AgentSwarmSnapshot {
  readonly swarmId: string;
  readonly workspaceId: string;
  readonly state: AgentSwarmState;
  readonly maxConcurrency: number;
  readonly executionDecision: AgentSwarmExecutionDecision;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tasks: readonly AgentSwarmTaskSnapshot[];
}

export interface AgentSwarmResultPage {
  readonly swarmId: string;
  readonly taskId: string;
  readonly state: AgentSwarmTaskState;
  readonly text: string;
  readonly nextCursor?: string;
  readonly eof: boolean;
  readonly outputTruncated: boolean;
}

export interface AgentSwarmListPage {
  readonly items: readonly AgentSwarmSnapshot[];
  readonly nextCursor?: string;
}
