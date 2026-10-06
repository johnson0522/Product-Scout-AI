import type {
  EvidenceId,
  OpportunityId,
  ProjectId,
  ResearchConstraints,
  ResearchRunId,
  ResearchStepId,
  ResearchStepType,
  SourceId,
} from '@product-scout/domain';

export type AgentSessionId = string;
export type AgentEventId = string;
export type ToolInvocationId = string;

export type AgentSessionStatus = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentRunStatus = 'completed' | 'failed' | 'cancelled';

export interface CreateSessionInput {
  readonly projectId: ProjectId;
  readonly researchRunId: ResearchRunId;
  readonly goal: string;
  readonly constraints?: ResearchConstraints;
}

export interface AgentSession {
  readonly id: AgentSessionId;
  readonly projectId: ProjectId;
  readonly researchRunId: ResearchRunId;
  readonly status: AgentSessionStatus;
  readonly createdAt: Date;
}

export interface AgentRunInput {
  readonly sessionId: AgentSessionId;
}

export interface AgentRunResult {
  readonly sessionId: AgentSessionId;
  readonly status: AgentRunStatus;
  readonly trajectory: AgentTrajectory;
}

export interface AgentTrajectory {
  readonly sessionId: AgentSessionId;
  readonly events: readonly AgentEvent[];
}

export interface AgentEventBase {
  readonly eventId: AgentEventId;
  readonly sessionId: AgentSessionId;
  readonly occurredAt: Date;
}

export interface AgentStartedEvent extends AgentEventBase {
  readonly type: 'agent.started';
  readonly researchRunId: ResearchRunId;
}

export interface ResearchStepStartedEvent extends AgentEventBase {
  readonly type: 'research.step.started';
  readonly researchRunId: ResearchRunId;
  readonly stepId: ResearchStepId;
  readonly stepType: ResearchStepType;
}

export interface ToolStartedEvent extends AgentEventBase {
  readonly type: 'tool.started';
  readonly toolInvocationId: ToolInvocationId;
  readonly toolName: string;
}

export interface ToolCompletedEvent extends AgentEventBase {
  readonly type: 'tool.completed';
  readonly toolInvocationId: ToolInvocationId;
  readonly toolName: string;
  readonly success: boolean;
  readonly errorMessage?: string;
}

export interface EvidenceCreatedEvent extends AgentEventBase {
  readonly type: 'evidence.created';
  readonly researchRunId: ResearchRunId;
  readonly evidenceId: EvidenceId;
  readonly sourceId: SourceId;
}

export interface ResearchStepCompletedEvent extends AgentEventBase {
  readonly type: 'research.step.completed';
  readonly researchRunId: ResearchRunId;
  readonly stepId: ResearchStepId;
  readonly stepType: ResearchStepType;
  readonly success: boolean;
  readonly errorMessage?: string;
}

export interface OpportunityCreatedEvent extends AgentEventBase {
  readonly type: 'opportunity.created';
  readonly researchRunId: ResearchRunId;
  readonly opportunityId: OpportunityId;
}

export interface AgentCompletedEvent extends AgentEventBase {
  readonly type: 'agent.completed';
  readonly researchRunId: ResearchRunId;
}

export interface AgentFailedEvent extends AgentEventBase {
  readonly type: 'agent.failed';
  readonly researchRunId: ResearchRunId;
  readonly errorMessage: string;
  readonly recoverable: boolean;
}

export type AgentEvent =
  | AgentStartedEvent
  | ResearchStepStartedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | EvidenceCreatedEvent
  | ResearchStepCompletedEvent
  | OpportunityCreatedEvent
  | AgentCompletedEvent
  | AgentFailedEvent;

export interface AgentRuntime {
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  run(input: AgentRunInput): Promise<AgentRunResult>;
  resume(sessionId: AgentSessionId): Promise<AgentRunResult>;
  cancel(sessionId: AgentSessionId): Promise<void>;
  getTrajectory(sessionId: AgentSessionId): Promise<AgentTrajectory>;
}
