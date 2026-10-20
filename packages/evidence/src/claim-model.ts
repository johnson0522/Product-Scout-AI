import type { ClaimId, ResearchRunId } from '@product-scout/domain';

import {
  createEvidenceReference,
  type EvidenceReference,
} from './evidence-model';

export type { ClaimId } from '@product-scout/domain';

export interface Claim {
  readonly id: ClaimId;
  readonly researchRunId: ResearchRunId;
  readonly text: string;
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly createdAt: Date;
}

export interface CreateClaimInput {
  readonly id: ClaimId;
  readonly researchRunId: ResearchRunId;
  readonly text: string;
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly createdAt: Date;
}

export class InvalidClaimError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidClaimError';
  }
}

export function createClaim(input: CreateClaimInput): Claim {
  const id = requireNonEmpty(input.id, 'id');
  const researchRunId = requireNonEmpty(input.researchRunId, 'researchRunId');
  const text = requireNonEmpty(input.text, 'text');
  if (input.evidenceRefs.length === 0) {
    throw new InvalidClaimError('evidenceRefs must contain at least one EvidenceReference');
  }

  const evidenceRefs = input.evidenceRefs.map((reference) => {
    try {
      return createEvidenceReference(reference.evidenceId);
    } catch (error: unknown) {
      throw new InvalidClaimError(error instanceof Error ? error.message : String(error));
    }
  });
  const evidenceIds = evidenceRefs.map((reference) => reference.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new InvalidClaimError('evidenceRefs must not contain duplicate EvidenceIds');
  }
  if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) {
    throw new InvalidClaimError('createdAt must be a valid Date');
  }

  return {
    id,
    researchRunId,
    text,
    evidenceRefs,
    createdAt: new Date(input.createdAt.getTime()),
  };
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidClaimError(field + ' must be a non-empty string');
  }
  return value.trim();
}
