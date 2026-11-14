import { describe, expect, it } from 'vitest';
import {
  createEvidence,
  type AcquireEvidenceInput,
  type AcquireEvidenceResult,
  type Claim,
  type ClaimRepository,
  type Evidence,
  type EvidenceAcquisition,
  type EvidenceAcquisitionRepository,
  type EvidenceAcquisitionScope,
  type EvidenceRepository,
  type ResearchFindingRepository,
} from '@product-scout/evidence';
import type { Finding } from '@product-scout/domain';

import {
  ClaimResearchRunMismatchError,
  EvidenceNotAcquiredForResearchRunError,
  ReferencedClaimNotFoundError,
  ReferencedEvidenceNotFoundError,
  ResearchFindingService,
  ResearchAggregateConflictError,
} from '../src';

class MemoryEvidenceAcquisitionRepository implements EvidenceAcquisitionRepository {
  public constructor(private readonly associations: ReadonlySet<string>) {}

  public async acquire(_input: AcquireEvidenceInput): Promise<AcquireEvidenceResult> {
    throw new Error('not used');
  }

  public async getByScope(_scope: EvidenceAcquisitionScope): Promise<EvidenceAcquisition | null> {
    return null;
  }

  public async listByResearchRunId(_researchRunId: string): Promise<readonly EvidenceAcquisition[]> {
    return [];
  }

  public async isAssociatedWithResearchRun(
    researchRunId: string,
    evidenceId: string,
  ): Promise<boolean> {
    return this.associations.has(`${researchRunId}\u0000${evidenceId}`);
  }
}

class MemoryEvidenceRepository implements EvidenceRepository {
  public constructor(private readonly values: readonly Evidence[]) {}

  public async create(): Promise<void> {
    throw new Error('not used');
  }

  public async getById(id: string): Promise<Evidence | null> {
    return this.values.find((evidence) => evidence.id === id) ?? null;
  }
}

class MemoryClaimRepository implements ClaimRepository {
  public readonly values: Claim[] = [];

  public async create(claim: Claim): Promise<void> {
    if (this.values.some((value) => value.id === claim.id)) {
      throw new Error('duplicate claim');
    }
    this.values.push(claim);
  }

  public async getById(id: string): Promise<Claim | null> {
    return this.values.find((claim) => claim.id === id) ?? null;
  }

  public async listByResearchRunId(researchRunId: string): Promise<readonly Claim[]> {
    return this.values.filter((claim) => claim.researchRunId === researchRunId);
  }
}

class MemoryFindingRepository implements ResearchFindingRepository {
  public readonly values: Finding[] = [];

  public async create(finding: Finding): Promise<void> {
    if (this.values.some((value) => value.id === finding.id)) {
      throw new Error('duplicate finding');
    }
    this.values.push(finding);
  }

  public async getById(id: string): Promise<Finding | null> {
    return this.values.find((finding) => finding.id === id) ?? null;
  }

  public async listByResearchRunId(researchRunId: string): Promise<readonly Finding[]> {
    return this.values.filter((finding) => finding.researchRunId === researchRunId);
  }
}

const evidence = createEvidence({
  id: 'evidence-1',
  source: { url: 'https://example.test/source' },
  title: 'Observed workflow pain',
  excerpt: 'Teams reconcile the same records every week.',
  retrievedAt: new Date('2026-10-19T00:00:00.000Z'),
});

function setup(
  evidenceValues: readonly Evidence[] = [evidence],
  associatedRuns: readonly string[] = ['run-1', 'run-2'],
) {
  const evidenceRepository = new MemoryEvidenceRepository(evidenceValues);
  const evidenceAcquisitions = new MemoryEvidenceAcquisitionRepository(new Set(
    evidenceValues.flatMap((item) => associatedRuns.map((runId) =>
      `${runId}\u0000${item.id}`)),
  ));
  const claimRepository = new MemoryClaimRepository();
  const findingRepository = new MemoryFindingRepository();
  return {
    evidenceRepository,
    claimRepository,
    findingRepository,
    service: new ResearchFindingService(
      evidenceRepository,
      evidenceAcquisitions,
      claimRepository,
      findingRepository,
    ),
  };
}

const claimInput = {
  id: 'claim-1',
  researchRunId: 'run-1',
  text: 'Manual reconciliation is frequent.',
  evidenceRefs: [{ evidenceId: evidence.id }],
  createdAt: new Date('2026-10-19T01:00:00.123Z'),
};

const findingInput = {
  id: 'finding-1',
  researchRunId: 'run-1',
  type: 'insight' as const,
  title: 'Recurring manual reconciliation',
  description: 'The workflow creates a recurring operational burden.',
  claimIds: [claimInput.id],
  createdAt: new Date('2026-10-19T02:00:00.456Z'),
};

describe('ResearchFindingService', () => {
  it('creates a claim only after every referenced Evidence exists', async () => {
    const { service, claimRepository } = setup();

    const claim = await service.createClaim(claimInput);

    expect(claimRepository.values).toEqual([claim]);
  });

  it('rejects a missing Evidence before persisting the Claim', async () => {
    const { service, claimRepository } = setup([]);

    await expect(service.createClaim(claimInput))
      .rejects.toBeInstanceOf(ReferencedEvidenceNotFoundError);
    expect(claimRepository.values).toHaveLength(0);
  });

  it('rejects Evidence that was not acquired for the Claim ResearchRun', async () => {
    const { service, claimRepository } = setup([evidence], []);

    await expect(service.createClaim(claimInput))
      .rejects.toBeInstanceOf(EvidenceNotAcquiredForResearchRunError);
    expect(claimRepository.values).toHaveLength(0);
  });

  it('propagates Evidence repository failures and does not persist the Claim', async () => {
    const { service, evidenceRepository, claimRepository } = setup();
    evidenceRepository.getById = async () => {
      throw new Error('evidence query failed');
    };

    await expect(service.createClaim(claimInput)).rejects.toThrow('evidence query failed');
    expect(claimRepository.values).toHaveLength(0);
  });

  it('creates a Finding only from Claims in the same ResearchRun', async () => {
    const { service, findingRepository } = setup();
    await service.createClaim(claimInput);

    const finding = await service.createFinding(findingInput);

    expect(findingRepository.values).toEqual([finding]);
  });

  it('rejects missing and cross-run Claims before persisting a Finding', async () => {
    const missing = setup();
    await expect(missing.service.createFinding(findingInput))
      .rejects.toBeInstanceOf(ReferencedClaimNotFoundError);
    expect(missing.findingRepository.values).toHaveLength(0);

    const mismatch = setup();
    await mismatch.service.createClaim({ ...claimInput, researchRunId: 'run-2' });
    await expect(mismatch.service.createFinding(findingInput))
      .rejects.toBeInstanceOf(ClaimResearchRunMismatchError);
    expect(mismatch.findingRepository.values).toHaveLength(0);
  });

  it('traces a Finding through Claims and Evidence to source URLs', async () => {
    const { service } = setup();
    await service.createClaim(claimInput);
    await service.createFinding(findingInput);

    const trace = await service.traceFinding(findingInput.id);

    expect(trace.finding.id).toBe(findingInput.id);
    expect(trace.claims[0]?.claim.id).toBe(claimInput.id);
    expect(trace.claims[0]?.evidence.map((item) => item.id)).toEqual([evidence.id]);
    expect(trace.claims[0]?.sourceUrls).toEqual([evidence.source.url]);
  });

  it('propagates Claim and Finding repository write failures', async () => {
    const claimFailure = setup();
    claimFailure.claimRepository.create = async () => {
      throw new Error('claim insert failed');
    };
    await expect(claimFailure.service.createClaim(claimInput))
      .rejects.toThrow('claim insert failed');

    const findingFailure = setup();
    await findingFailure.service.createClaim(claimInput);
    findingFailure.findingRepository.create = async () => {
      throw new Error('finding insert failed');
    };
    await expect(findingFailure.service.createFinding(findingInput))
      .rejects.toThrow('finding insert failed');
  });

  it('reuses identical Claims and Findings while rejecting id conflicts', async () => {
    const { service, claimRepository, findingRepository } = setup();
    const claim = await service.ensureClaim(claimInput);
    const replayedClaim = await service.ensureClaim({
      ...claimInput,
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(replayedClaim).toBe(claimRepository.values[0]);
    expect(claimRepository.values).toHaveLength(1);

    await expect(service.ensureClaim({ ...claimInput, text: 'Different content.' }))
      .rejects.toBeInstanceOf(ResearchAggregateConflictError);

    const finding = await service.ensureFinding(findingInput);
    const replayedFinding = await service.ensureFinding({
      ...findingInput,
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(replayedFinding).toBe(findingRepository.values[0]);
    expect(findingRepository.values).toHaveLength(1);
    expect(finding.id).toBe(replayedFinding.id);

    await expect(service.ensureFinding({
      ...findingInput,
      description: 'Different content.',
    })).rejects.toBeInstanceOf(ResearchAggregateConflictError);
    expect(claim.id).toBe(replayedClaim.id);
  });
});
