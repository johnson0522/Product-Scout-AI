import { describe, expect, it, vi } from 'vitest';
import { createFinding } from '@product-scout/domain';
import { createClaim, createEvidence } from '@product-scout/evidence';

import {
  assessResearchFindingQuality,
  InvalidQualityAssessmentInputError,
  ResearchQualityAssessmentService,
  type ClaimEvidenceAssessmentInput,
  type ResearchFindingTrace,
} from '../src';

function trace(options: {
  readonly claimText?: string;
  readonly urls?: readonly string[];
} = {}): ResearchFindingTrace {
  const urls = options.urls ?? [
    'https://one.example.test/source',
    'https://two.example.test/source',
  ];
  const evidence = urls.map((url, index) => createEvidence({
    id: 'evidence-' + (index + 1),
    source: { url },
    title: 'Evidence ' + (index + 1),
    excerpt: 'Observed research material ' + (index + 1),
    retrievedAt: new Date('2026-10-19T00:00:00.000Z'),
  }));
  const claim = createClaim({
    id: 'claim-1',
    researchRunId: 'run-1',
    text: options.claimText ?? 'Teams report recurring reconciliation work.',
    evidenceRefs: evidence.map((item) => ({ evidenceId: item.id })),
    createdAt: new Date('2026-10-19T01:00:00.000Z'),
  });
  const finding = createFinding({
    id: 'finding-1',
    researchRunId: 'run-1',
    type: 'insight',
    title: 'Recurring reconciliation work',
    description: 'A traceable research finding.',
    claimIds: [claim.id],
    createdAt: new Date('2026-10-19T02:00:00.000Z'),
  });
  return {
    finding,
    claims: [{ claim, evidence, sourceUrls: evidence.map((item) => item.source.url) }],
  };
}

function assessed(
  relation: ClaimEvidenceAssessmentInput['relation'] = 'supports',
  evidenceIds: readonly string[] = ['evidence-1', 'evidence-2'],
): ClaimEvidenceAssessmentInput[] {
  return evidenceIds.map((evidenceId) => ({
    claimId: 'claim-1',
    evidenceId,
    relation,
    semanticKind: 'user_report',
    sourceKind: 'independent_third_party',
  }));
}

describe('assessResearchFindingQuality', () => {
  it('returns sufficient when two classified, distinct sources support the Claim', () => {
    const result = assessResearchFindingQuality(trace(), assessed());

    expect(result.status).toBe('sufficient');
    expect(result.issues).toEqual([]);
    expect(result.requiresHumanReview).toBe(false);
    expect(result.claims[0]?.ruleResults).toHaveLength(7);
    expect(result.claims[0]?.ruleResults.every((rule) =>
      rule.outcome === 'passed' || rule.outcome === 'not_applicable')).toBe(true);
  });

  it('treats missing relationship input as unclear and insufficient', () => {
    const result = assessResearchFindingQuality(trace(), []);

    expect(result.status).toBe('insufficient');
    expect(result.claims[0]?.unclearEvidenceIds).toEqual(['evidence-1', 'evidence-2']);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'UNASSESSED_EVIDENCE_RELATION',
      'NO_SUPPORTING_EVIDENCE',
      'EVIDENCE_CLASSIFICATION_INCOMPLETE',
    ]));
  });

  it('distinguishes a single source from duplicate Evidence using the same URL', () => {
    const single = assessResearchFindingQuality(
      trace({ urls: ['https://one.example.test/source'] }),
      assessed('supports', ['evidence-1']),
    );
    expect(single.issues.map((issue) => issue.code)).toContain('SINGLE_SUPPORTING_SOURCE');
    expect(single.issues.map((issue) => issue.code)).not.toContain('DUPLICATE_SUPPORTING_SOURCE');

    const duplicate = assessResearchFindingQuality(
      trace({ urls: [
        'https://one.example.test/source#first',
        'https://one.example.test/source#second',
      ] }),
      assessed(),
    );
    expect(duplicate.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SINGLE_SUPPORTING_SOURCE',
      'DUPLICATE_SUPPORTING_SOURCE',
    ]));
    expect(duplicate.claims[0]?.distinctSupportingSourceUrls).toEqual([
      'https://one.example.test/source',
    ]);
  });

  it('creates a conflict candidate without claiming automatic contradiction resolution', () => {
    const result = assessResearchFindingQuality(trace(), [
      ...assessed('supports', ['evidence-1']),
      ...assessed('contradicts', ['evidence-2']),
    ]);

    expect(result.status).toBe('conflicted');
    expect(result.conflictCandidates).toEqual([expect.objectContaining({
      claimId: 'claim-1',
      supportingEvidenceIds: ['evidence-1'],
      contradictingEvidenceIds: ['evidence-2'],
      requiresHumanReview: true,
    })]);
  });

  it('flags incomplete caller-provided classifications', () => {
    const inputs = assessed().map((input, index) => index === 0
      ? { ...input, semanticKind: 'unknown' as const }
      : input);
    const result = assessResearchFindingQuality(trace(), inputs);

    expect(result.status).toBe('needs_review');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'EVIDENCE_CLASSIFICATION_INCOMPLETE',
      evidenceIds: ['evidence-1'],
    }));
  });

  it('flags strong language only when supporting source diversity is limited', () => {
    const limited = assessResearchFindingQuality(
      trace({
        claimText: 'All teams always experience this problem.',
        urls: ['https://one.example.test/source'],
      }),
      assessed('supports', ['evidence-1']),
    );
    expect(limited.issues.map((issue) => issue.code))
      .toContain('STRONG_CLAIM_WITH_LIMITED_SUPPORT');

    const diverse = assessResearchFindingQuality(
      trace({ claimText: '所有团队一定会遇到这个问题。' }),
      assessed(),
    );
    expect(diverse.issues.map((issue) => issue.code))
      .not.toContain('STRONG_CLAIM_WITH_LIMITED_SUPPORT');
  });

  it('rejects duplicate and unrelated relationship inputs', () => {
    const duplicate = assessed('supports', ['evidence-1']);
    expect(() => assessResearchFindingQuality(trace(), [...duplicate, ...duplicate]))
      .toThrow(InvalidQualityAssessmentInputError);
    expect(() => assessResearchFindingQuality(trace(), [{
      ...duplicate[0]!,
      evidenceId: 'not-referenced',
    }])).toThrow('is not referenced by Claim');
  });

  it('aggregates Claim status with conflicted taking precedence', () => {
    const first = trace();
    const secondEvidence = createEvidence({
      id: 'evidence-3',
      source: { url: 'https://three.example.test/source' },
      title: 'Third evidence',
      excerpt: 'A third research observation.',
      retrievedAt: new Date('2026-10-19T00:00:00.000Z'),
    });
    const secondClaim = createClaim({
      id: 'claim-2',
      researchRunId: 'run-1',
      text: 'A second claim.',
      evidenceRefs: [{ evidenceId: secondEvidence.id }],
      createdAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    const multiTrace: ResearchFindingTrace = {
      finding: createFinding({
        ...first.finding,
        claimIds: ['claim-1', 'claim-2'],
      }),
      claims: [
        ...first.claims,
        { claim: secondClaim, evidence: [secondEvidence], sourceUrls: [secondEvidence.source.url] },
      ],
    };
    const result = assessResearchFindingQuality(multiTrace, [
      ...assessed('supports', ['evidence-1']),
      ...assessed('contradicts', ['evidence-2']),
    ]);

    expect(result.claims.map((claim) => claim.status)).toEqual(['conflicted', 'insufficient']);
    expect(result.status).toBe('conflicted');
  });
});

describe('ResearchQualityAssessmentService', () => {
  it('loads the D1 trace and delegates to deterministic assessment', async () => {
    const traceFinding = vi.fn(async () => trace());
    const service = new ResearchQualityAssessmentService({ traceFinding });

    const result = await service.assessFinding('finding-1', assessed());

    expect(traceFinding).toHaveBeenCalledWith('finding-1');
    expect(result.status).toBe('sufficient');
  });

  it('propagates D1 trace failures', async () => {
    const service = new ResearchQualityAssessmentService({
      traceFinding: async () => {
        throw new Error('repository unavailable');
      },
    });

    await expect(service.assessFinding('finding-1', []))
      .rejects.toThrow('repository unavailable');
  });
});
