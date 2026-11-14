import {
  createFinding,
  type CreateFindingInput,
  type Finding,
  type FindingId,
} from '@product-scout/domain';
import {
  createClaim,
  type Claim,
  type ClaimId,
  type ClaimRepository,
  type CreateClaimInput,
  type Evidence,
  type EvidenceAcquisitionRepository,
  type EvidenceId,
  type EvidenceRepository,
  type ResearchFindingRepository,
} from '@product-scout/evidence';

export class ReferencedEvidenceNotFoundError extends Error {
  public constructor(public readonly evidenceId: EvidenceId) {
    super('Referenced evidence not found: ' + evidenceId);
    this.name = 'ReferencedEvidenceNotFoundError';
  }
}

export class EvidenceNotAcquiredForResearchRunError extends Error {
  public constructor(
    public readonly evidenceId: EvidenceId,
    public readonly researchRunId: string,
  ) {
    super(`Evidence ${evidenceId} is not associated with research run ${researchRunId}`);
    this.name = 'EvidenceNotAcquiredForResearchRunError';
  }
}

export class ReferencedClaimNotFoundError extends Error {
  public constructor(public readonly claimId: ClaimId) {
    super('Referenced claim not found: ' + claimId);
    this.name = 'ReferencedClaimNotFoundError';
  }
}

export class ClaimResearchRunMismatchError extends Error {
  public constructor(
    public readonly claimId: ClaimId,
    public readonly findingResearchRunId: string,
    public readonly claimResearchRunId: string,
  ) {
    super(
      'Claim ' + claimId + ' belongs to research run ' + claimResearchRunId
      + ', not ' + findingResearchRunId,
    );
    this.name = 'ClaimResearchRunMismatchError';
  }
}

export class ResearchFindingNotFoundError extends Error {
  public constructor(public readonly findingId: FindingId) {
    super('Research finding not found: ' + findingId);
    this.name = 'ResearchFindingNotFoundError';
  }
}

export class ResearchAggregateConflictError extends Error {
  public constructor(
    public readonly aggregate: 'Claim' | 'Finding',
    public readonly id: string,
  ) {
    super(`${aggregate} ${id} already exists with different content`);
    this.name = 'ResearchAggregateConflictError';
  }
}

export interface ClaimEvidenceTrace {
  readonly claim: Claim;
  readonly evidence: readonly Evidence[];
  readonly sourceUrls: readonly string[];
}

export interface ResearchFindingTrace {
  readonly finding: Finding;
  readonly claims: readonly ClaimEvidenceTrace[];
}

export class ResearchFindingService {
  public constructor(
    private readonly evidenceRepository: EvidenceRepository,
    private readonly evidenceAcquisitions: EvidenceAcquisitionRepository,
    private readonly claimRepository: ClaimRepository,
    private readonly findingRepository: ResearchFindingRepository,
  ) {}

  public async createClaim(input: CreateClaimInput): Promise<Claim> {
    const claim = createClaim(input);
    await this.validateClaimEvidence(claim);
    await this.claimRepository.create(claim);
    return claim;
  }

  /** Reuses a semantically identical Claim when an invocation is replayed. */
  public async ensureClaim(input: CreateClaimInput): Promise<Claim> {
    const claim = createClaim(input);
    const existing = await this.claimRepository.getById(claim.id);
    if (existing !== null) return requireSameClaim(existing, claim);

    await this.validateClaimEvidence(claim);
    try {
      await this.claimRepository.create(claim);
      return claim;
    } catch (writeError: unknown) {
      const concurrent = await this.claimRepository.getById(claim.id);
      if (concurrent !== null) return requireSameClaim(concurrent, claim);
      throw writeError;
    }
  }

  public async createFinding(input: CreateFindingInput): Promise<Finding> {
    const finding = createFinding(input);
    await this.validateFindingClaims(finding);
    await this.findingRepository.create(finding);
    return finding;
  }

  /** Reuses a semantically identical Finding when an invocation is replayed. */
  public async ensureFinding(input: CreateFindingInput): Promise<Finding> {
    const finding = createFinding(input);
    const existing = await this.findingRepository.getById(finding.id);
    if (existing !== null) return requireSameFinding(existing, finding);

    await this.validateFindingClaims(finding);
    try {
      await this.findingRepository.create(finding);
      return finding;
    } catch (writeError: unknown) {
      const concurrent = await this.findingRepository.getById(finding.id);
      if (concurrent !== null) return requireSameFinding(concurrent, finding);
      throw writeError;
    }
  }

  public async traceFinding(findingId: FindingId): Promise<ResearchFindingTrace> {
    const finding = await this.findingRepository.getById(findingId);
    if (finding === null) {
      throw new ResearchFindingNotFoundError(findingId);
    }

    const claims: ClaimEvidenceTrace[] = [];
    for (const claimId of finding.claimIds) {
      const claim = await this.claimRepository.getById(claimId);
      if (claim === null) {
        throw new ReferencedClaimNotFoundError(claimId);
      }
      if (claim.researchRunId !== finding.researchRunId) {
        throw new ClaimResearchRunMismatchError(
          claim.id,
          finding.researchRunId,
          claim.researchRunId,
        );
      }

      const evidenceItems: Evidence[] = [];
      for (const reference of claim.evidenceRefs) {
        const evidence = await this.evidenceRepository.getById(reference.evidenceId);
        if (evidence === null) {
          throw new ReferencedEvidenceNotFoundError(reference.evidenceId);
        }
        evidenceItems.push(evidence);
      }
      claims.push({
        claim,
        evidence: evidenceItems,
        sourceUrls: evidenceItems.map((evidence) => evidence.source.url),
      });
    }

    return { finding, claims };
  }

  private async validateClaimEvidence(claim: Claim): Promise<void> {
    for (const reference of claim.evidenceRefs) {
      const evidence = await this.evidenceRepository.getById(reference.evidenceId);
      if (evidence === null) {
        throw new ReferencedEvidenceNotFoundError(reference.evidenceId);
      }
      const associated = await this.evidenceAcquisitions.isAssociatedWithResearchRun(
        claim.researchRunId,
        reference.evidenceId,
      );
      if (!associated) {
        throw new EvidenceNotAcquiredForResearchRunError(
          reference.evidenceId,
          claim.researchRunId,
        );
      }
    }
  }

  private async validateFindingClaims(finding: Finding): Promise<void> {
    for (const claimId of finding.claimIds) {
      const claim = await this.claimRepository.getById(claimId);
      if (claim === null) {
        throw new ReferencedClaimNotFoundError(claimId);
      }
      if (claim.researchRunId !== finding.researchRunId) {
        throw new ClaimResearchRunMismatchError(
          claim.id,
          finding.researchRunId,
          claim.researchRunId,
        );
      }
    }
  }
}

function requireSameClaim(existing: Claim, requested: Claim): Claim {
  const same = existing.researchRunId === requested.researchRunId
    && existing.text === requested.text
    && sameValues(
      existing.evidenceRefs.map((reference) => reference.evidenceId),
      requested.evidenceRefs.map((reference) => reference.evidenceId),
    );
  if (!same) throw new ResearchAggregateConflictError('Claim', requested.id);
  return existing;
}

function requireSameFinding(existing: Finding, requested: Finding): Finding {
  const same = existing.researchRunId === requested.researchRunId
    && existing.type === requested.type
    && existing.title === requested.title
    && existing.description === requested.description
    && sameValues(existing.claimIds, requested.claimIds);
  if (!same) throw new ResearchAggregateConflictError('Finding', requested.id);
  return existing;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
