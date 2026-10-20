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
    private readonly claimRepository: ClaimRepository,
    private readonly findingRepository: ResearchFindingRepository,
  ) {}

  public async createClaim(input: CreateClaimInput): Promise<Claim> {
    const claim = createClaim(input);
    for (const reference of claim.evidenceRefs) {
      const evidence = await this.evidenceRepository.getById(reference.evidenceId);
      if (evidence === null) {
        throw new ReferencedEvidenceNotFoundError(reference.evidenceId);
      }
    }

    await this.claimRepository.create(claim);
    return claim;
  }

  public async createFinding(input: CreateFindingInput): Promise<Finding> {
    const finding = createFinding(input);
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

    await this.findingRepository.create(finding);
    return finding;
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
}
