import type { ResearchRunStatus } from '@product-scout/domain';

const allowedTransitions: Readonly<Record<ResearchRunStatus, readonly ResearchRunStatus[]>> = {
  pending: ['running', 'failed', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export class InvalidResearchTransitionError extends Error {
  public constructor(
    public readonly from: ResearchRunStatus,
    public readonly to: ResearchRunStatus,
  ) {
    super(`Invalid research state transition: ${from} -> ${to}`);
    this.name = 'InvalidResearchTransitionError';
  }
}

export function assertResearchTransition(
  from: ResearchRunStatus,
  to: ResearchRunStatus,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidResearchTransitionError(from, to);
  }
}
