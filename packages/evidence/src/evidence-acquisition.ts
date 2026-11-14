import type { ResearchRunId, ResearchStepType } from '@product-scout/domain';

import type { Evidence, EvidenceId } from './evidence-model';

export type EvidenceAcquisitionId = string;
export type EvidenceSourceFingerprint = string;

export interface EvidenceAcquisitionScope {
  readonly researchRunId: ResearchRunId;
  readonly workflowInvocationKey: string;
  readonly stepId: ResearchStepType;
  readonly sourceFingerprint: EvidenceSourceFingerprint;
}

export interface EvidenceAcquisition extends EvidenceAcquisitionScope {
  readonly id: EvidenceAcquisitionId;
  readonly evidenceId: EvidenceId;
  readonly capturedAt: Date;
}

export interface AcquireEvidenceInput extends EvidenceAcquisitionScope {
  readonly evidence: Evidence;
  readonly capturedAt: Date;
}

export interface AcquireEvidenceResult {
  readonly status: 'created' | 'existing';
  readonly evidence: Evidence;
  readonly acquisition: EvidenceAcquisition;
}

export class InvalidEvidenceAcquisitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidEvidenceAcquisitionError';
  }
}

export class EvidenceIdentityConflictError extends Error {
  public constructor(public readonly evidenceId: EvidenceId) {
    super(`Evidence ${evidenceId} already exists with different content`);
    this.name = 'EvidenceIdentityConflictError';
  }
}

const researchStepTypes: readonly ResearchStepType[] = [
  'market_understanding',
  'pain_point_research',
  'competitor_research',
  'market_signal_research',
  'opportunity_analysis',
  'report_generation',
];

export function createEvidenceAcquisition(
  input: EvidenceAcquisition,
): EvidenceAcquisition {
  const capturedAt = validDate(input.capturedAt, 'capturedAt');
  return {
    id: nonEmpty(input.id, 'id'),
    evidenceId: nonEmpty(input.evidenceId, 'evidenceId'),
    researchRunId: nonEmpty(input.researchRunId, 'researchRunId'),
    workflowInvocationKey: nonEmpty(
      input.workflowInvocationKey,
      'workflowInvocationKey',
    ),
    stepId: validStepId(input.stepId),
    sourceFingerprint: validFingerprint(input.sourceFingerprint),
    capturedAt,
  };
}

export function validateEvidenceAcquisitionScope(
  scope: EvidenceAcquisitionScope,
): EvidenceAcquisitionScope {
  return {
    researchRunId: nonEmpty(scope.researchRunId, 'researchRunId'),
    workflowInvocationKey: nonEmpty(
      scope.workflowInvocationKey,
      'workflowInvocationKey',
    ),
    stepId: validStepId(scope.stepId),
    sourceFingerprint: validFingerprint(scope.sourceFingerprint),
  };
}

export function validateAcquireEvidenceInput(
  input: AcquireEvidenceInput,
): AcquireEvidenceInput {
  return {
    evidence: input.evidence,
    ...validateEvidenceAcquisitionScope(input),
    capturedAt: validDate(input.capturedAt, 'capturedAt'),
  };
}

function validFingerprint(value: string): EvidenceSourceFingerprint {
  const fingerprint = nonEmpty(value, 'sourceFingerprint');
  if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint)) {
    throw new InvalidEvidenceAcquisitionError(
      'sourceFingerprint must use the sha256:<64 lowercase hex characters> format',
    );
  }
  return fingerprint;
}

function validStepId(value: ResearchStepType): ResearchStepType {
  if (!researchStepTypes.includes(value)) {
    throw new InvalidEvidenceAcquisitionError(`Unknown stepId: ${String(value)}`);
  }
  return value;
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidEvidenceAcquisitionError(`${field} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidEvidenceAcquisitionError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

