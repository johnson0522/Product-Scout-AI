import type {
  ResearchConstraints,
  ResearchRunId,
  ResearchStepType,
} from '@product-scout/domain';

export type ResearchWorkflowStepId = ResearchStepType;

export type ResearchWorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ResearchWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type ResearchWorkflowStepReadiness =
  | 'ready'
  | 'blocked'
  | 'dependency_failed';

export interface ResearchWorkflowStepDefinition {
  readonly id: ResearchWorkflowStepId;
  readonly dependsOn: readonly ResearchWorkflowStepId[];
  readonly allowSkip: boolean;
  readonly maxAttempts: number;
}

export interface ResearchWorkflowDefinition {
  readonly id: string;
  readonly steps: readonly ResearchWorkflowStepDefinition[];
}

export interface StartResearchWorkflowInput {
  readonly researchRunId: ResearchRunId;
  readonly goal: string;
  readonly constraints?: ResearchConstraints;
  readonly idempotencyKey?: string;
}

export interface ResearchWorkflowFailureBase {
  readonly message: string;
  readonly retryable: boolean;
}

export type ResearchWorkflowFailure =
  | (ResearchWorkflowFailureBase & {
      readonly kind: 'invalid_input' | 'precondition_failed' | 'cancelled';
      readonly retryable: false;
    })
  | (ResearchWorkflowFailureBase & {
      readonly kind: 'dependency_failed' | 'execution_failed' | 'unknown';
    })
  | (ResearchWorkflowFailureBase & {
      readonly kind: 'timeout';
      readonly retryable: true;
    });

export interface ResearchWorkflowExecution {
  readonly workflowId: string;
  readonly researchRunId: ResearchRunId;
  readonly status: ResearchWorkflowStatus;
  readonly steps: readonly ResearchWorkflowStepExecution[];
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly failure?: ResearchWorkflowFailure;
}

export interface ResearchWorkflowStepExecution {
  readonly stepId: ResearchWorkflowStepId;
  readonly status: ResearchWorkflowStepStatus;
  readonly attempt: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly skipReason?: string;
  readonly failure?: ResearchWorkflowFailure;
  readonly result?: ResearchWorkflowStepResult;
}

export interface ResearchWorkflowStepDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type ResearchWorkflowArtifact =
  | {
      readonly kind: 'evidence';
      readonly evidenceId: string;
      readonly stepId: Exclude<
        ResearchWorkflowStepId,
        'opportunity_analysis' | 'report_generation'
      >;
    }
  | {
      readonly kind: 'finding';
      readonly findingId: string;
      readonly claimIds: readonly string[];
    }
  | {
      readonly kind: 'quality_assessment';
      readonly findingId: string;
      readonly status: 'sufficient' | 'insufficient' | 'conflicted' | 'needs_review';
      readonly issueCodes: readonly string[];
      readonly requiresHumanReview: boolean;
    }
  | {
      readonly kind: 'opportunity';
      readonly opportunityId: string;
      readonly findingIds: readonly string[];
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly kind: 'report';
      readonly reportId: string;
      readonly findingIds: readonly string[];
      readonly opportunityIds: readonly string[];
    }
  | {
      readonly kind: 'validation_plan';
      readonly validationPlanId: string;
      readonly reportId: string;
    };

export type ResearchWorkflowStepResult =
  | {
      readonly status: 'completed';
      readonly stepId: ResearchWorkflowStepId;
      readonly artifactIds: readonly string[];
      readonly artifacts?: readonly ResearchWorkflowArtifact[];
      readonly diagnostics?: readonly ResearchWorkflowStepDiagnostic[];
    }
  | {
      readonly status: 'skipped';
      readonly stepId: ResearchWorkflowStepId;
      readonly reason: string;
    }
  | {
      readonly status: 'failed';
      readonly stepId: ResearchWorkflowStepId;
      readonly failure: ResearchWorkflowFailure;
    };

export const DEFAULT_RESEARCH_WORKFLOW_DEFINITION: ResearchWorkflowDefinition = {
  id: 'product-scout-research-v0.1',
  steps: [
    step('market_understanding'),
    step('pain_point_research', ['market_understanding']),
    step('competitor_research', ['market_understanding']),
    step('market_signal_research', ['market_understanding']),
    step('opportunity_analysis', [
      'pain_point_research',
      'competitor_research',
      'market_signal_research',
    ]),
    step('report_generation', ['opportunity_analysis']),
  ],
};

/**
 * A deliberately partial workflow whose contract ends after evidence-backed
 * Finding and Quality artifacts. It must not be presented as a full V0.1 report.
 */
export const RESEARCH_ANALYSIS_WORKFLOW_DEFINITION: ResearchWorkflowDefinition = {
  id: 'product-scout-analysis-v0.1',
  steps: DEFAULT_RESEARCH_WORKFLOW_DEFINITION.steps.filter(
    (definition) => definition.id !== 'report_generation',
  ),
};

export class InvalidResearchWorkflowInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidResearchWorkflowInputError';
  }
}

export class InvalidResearchWorkflowTransitionError extends Error {
  public constructor(
    public readonly from: ResearchWorkflowStatus,
    public readonly to: ResearchWorkflowStatus,
  ) {
    super(`Invalid research workflow transition: ${from} -> ${to}`);
    this.name = 'InvalidResearchWorkflowTransitionError';
  }
}

export class InvalidResearchWorkflowStepTransitionError extends Error {
  public constructor(
    public readonly from: ResearchWorkflowStepStatus,
    public readonly to: ResearchWorkflowStepStatus,
  ) {
    super(`Invalid research workflow step transition: ${from} -> ${to}`);
    this.name = 'InvalidResearchWorkflowStepTransitionError';
  }
}

const workflowTransitions: Readonly<Record<
  ResearchWorkflowStatus,
  readonly ResearchWorkflowStatus[]
>> = {
  pending: ['running', 'failed', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const stepTransitions: Readonly<Record<
  ResearchWorkflowStepStatus,
  readonly ResearchWorkflowStepStatus[]
>> = {
  pending: ['running', 'skipped', 'cancelled'],
  running: ['completed', 'failed', 'skipped', 'cancelled'],
  completed: [],
  failed: ['pending'],
  skipped: [],
  cancelled: [],
};

export function assertResearchWorkflowTransition(
  from: ResearchWorkflowStatus,
  to: ResearchWorkflowStatus,
): void {
  if (!workflowTransitions[from].includes(to)) {
    throw new InvalidResearchWorkflowTransitionError(from, to);
  }
}

export function assertResearchWorkflowStepTransition(
  from: ResearchWorkflowStepStatus,
  to: ResearchWorkflowStepStatus,
): void {
  if (!stepTransitions[from].includes(to)) {
    throw new InvalidResearchWorkflowStepTransitionError(from, to);
  }
}

export function canRetryResearchWorkflowStep(
  execution: Pick<ResearchWorkflowStepExecution, 'status' | 'attempt' | 'failure'>,
  definition: ResearchWorkflowStepDefinition,
): boolean {
  return execution.status === 'failed'
    && execution.failure?.retryable === true
    && execution.attempt < definition.maxAttempts;
}

export function canSkipResearchWorkflowStep(
  execution: Pick<ResearchWorkflowStepExecution, 'status'>,
  definition: ResearchWorkflowStepDefinition,
): boolean {
  return execution.status === 'pending' && definition.allowSkip;
}

export function getResearchWorkflowStepReadiness(
  definition: ResearchWorkflowStepDefinition,
  executions: readonly Pick<ResearchWorkflowStepExecution, 'stepId' | 'status'>[],
): ResearchWorkflowStepReadiness {
  const statusByStep = new Map(executions.map((item) => [item.stepId, item.status]));
  const dependencyStatuses = definition.dependsOn.map((id) => statusByStep.get(id));
  if (dependencyStatuses.some((status) =>
    status === 'failed' || status === 'skipped' || status === 'cancelled')) {
    return 'dependency_failed';
  }
  return dependencyStatuses.every((status) => status === 'completed')
    ? 'ready'
    : 'blocked';
}

/**
 * Identifies duplicate start requests within the application contract. Durable
 * cross-process enforcement still requires a persistent coordinator.
 */
export function getResearchWorkflowInvocationKey(
  input: StartResearchWorkflowInput,
): string {
  const validInput = validateStartResearchWorkflowInput(input);
  return validInput.idempotencyKey ?? validInput.researchRunId;
}

export function validateStartResearchWorkflowInput(
  input: StartResearchWorkflowInput,
): StartResearchWorkflowInput {
  if (input.researchRunId.trim() === '') {
    throw new InvalidResearchWorkflowInputError('researchRunId must be a non-empty string');
  }
  if (input.goal.trim() === '') {
    throw new InvalidResearchWorkflowInputError('goal must be a non-empty string');
  }
  if (input.idempotencyKey !== undefined && input.idempotencyKey.trim() === '') {
    throw new InvalidResearchWorkflowInputError('idempotencyKey must be non-empty when provided');
  }

  return {
    ...input,
    researchRunId: input.researchRunId.trim(),
    goal: input.goal.trim(),
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey.trim() }),
  };
}

export function validateResearchWorkflowDefinition(
  definition: ResearchWorkflowDefinition,
): void {
  if (definition.id.trim() === '') {
    throw new InvalidResearchWorkflowInputError('workflow definition id must be non-empty');
  }
  const stepIds = new Set<ResearchWorkflowStepId>();
  for (const item of definition.steps) {
    if (stepIds.has(item.id)) {
      throw new InvalidResearchWorkflowInputError(`Duplicate workflow step: ${item.id}`);
    }
    stepIds.add(item.id);
    if (!Number.isSafeInteger(item.maxAttempts) || item.maxAttempts < 1) {
      throw new InvalidResearchWorkflowInputError(
        `maxAttempts must be a positive integer for ${item.id}`,
      );
    }
    for (const dependency of item.dependsOn) {
      if (dependency === item.id) {
        throw new InvalidResearchWorkflowInputError(
          `Workflow step ${item.id} cannot depend on itself`,
        );
      }
    }
  }

  for (const item of definition.steps) {
    for (const dependency of item.dependsOn) {
      if (!stepIds.has(dependency)) {
        throw new InvalidResearchWorkflowInputError(
          `Workflow step ${item.id} depends on undefined step ${dependency}`,
        );
      }
    }
  }

  getResearchWorkflowExecutionOrder(definition);
}

export function getResearchWorkflowExecutionOrder(
  definition: ResearchWorkflowDefinition,
): readonly ResearchWorkflowStepId[] {
  const steps = new Map(definition.steps.map((item) => [item.id, item]));
  const visiting = new Set<ResearchWorkflowStepId>();
  const visited = new Set<ResearchWorkflowStepId>();
  const order: ResearchWorkflowStepId[] = [];

  const visit = (id: ResearchWorkflowStepId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new InvalidResearchWorkflowInputError(
        `Workflow dependency cycle detected at ${id}`,
      );
    }
    const item = steps.get(id);
    if (item === undefined) {
      throw new InvalidResearchWorkflowInputError(`Workflow step is undefined: ${id}`);
    }
    visiting.add(id);
    for (const dependency of item.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };

  for (const item of definition.steps) visit(item.id);
  return order;
}

function step(
  id: ResearchWorkflowStepId,
  dependsOn: readonly ResearchWorkflowStepId[] = [],
): ResearchWorkflowStepDefinition {
  return {
    id,
    dependsOn,
    allowSkip: false,
    maxAttempts: 1,
  };
}
