import type { ResearchQualitySnapshot, QualityIssue } from '../../packages/evidence/src/research-quality-model';

/** Explicit fixture, never used as a production assessment or transport. */
export function qualitySnapshotFixture(options: {
  researchRunId?: string; findingId?: string; claimId?: string; evidenceId?: string;
} = {}): ResearchQualitySnapshot {
  const researchRunId = options.researchRunId ?? '30000000-0000-4000-8000-000000000003';
  const findingId = options.findingId ?? 'f1';
  const claimId = options.claimId ?? 'c1';
  const evidenceId = options.evidenceId ?? 'e1';
  const issue: QualityIssue = {
    code: 'SINGLE_SUPPORTING_SOURCE', ruleId: 'RQC-003', claimId, evidenceIds: [evidenceId],
    sourceUrls: ['https://example.com/original'], reason: 'The Claim relies on fewer than two distinct supporting source URLs.',
    blocking: false, requiresHumanReview: true,
  };
  const ruleIds = ['RQC-001', 'RQC-002', 'RQC-003', 'RQC-004', 'RQC-005', 'RQC-006', 'RQC-007'] as const;
  return {
    researchRunId, findingId, workflowInvocationKey: 'quality-test-invocation', rulesVersion: 'rqc-v1',
    assessedAt: new Date('2026-11-22T01:02:03.456Z'),
    inputs: [{ claimId, evidenceId, relation: 'supports', semanticKind: 'user_report', sourceKind: 'community' }],
    assessment: {
      findingId, status: 'needs_review', requiresHumanReview: true, issues: [issue], conflictCandidates: [],
      claims: [{
        claimId, status: 'needs_review', requiresHumanReview: true, issues: [issue], conflictCandidates: [],
        supportingEvidenceIds: [evidenceId], contradictingEvidenceIds: [], unclearEvidenceIds: [],
        distinctSupportingSourceUrls: ['https://example.com/original'],
        ruleResults: ruleIds.map((ruleId) => ({ ruleId, claimId, evidenceIds: [evidenceId],
          outcome: ruleId === 'RQC-003' ? 'triggered' : 'passed', reason: ruleId === 'RQC-003' ? issue.reason : 'Fixture rule passed.',
          blocking: false, requiresHumanReview: ruleId === 'RQC-003' })),
      }],
    },
  };
}
