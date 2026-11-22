import type { ClaimId } from '@product-scout/evidence';
import { createResearchQualitySnapshot, RESEARCH_QUALITY_RULES_VERSION, type ResearchQualitySnapshotRepository } from '@product-scout/evidence';

import {
  createOpportunityAggregateId,
  OpportunityAnalysisService,
  type OpportunityAnalysisFindingInput,
  type OpportunityAnalysisPlanProvider,
  type OpportunityStore,
} from './opportunity-analysis';

import type { ResearchFindingService } from './research-finding-service';
import type {
  ClaimEvidenceAssessmentInput,
  ResearchQualityAssessment,
  ResearchQualityAssessmentService,
} from './research-quality';
import {
  createSynthesisAggregateId,
  validateResearchSynthesisPlan,
  type ResearchSynthesisEvidenceInput,
  type ResearchSynthesisPlanProvider,
} from './research-synthesis';
import {
  getResearchWorkflowInvocationKey,
  getResearchWorkflowGoal,
  type ResearchWorkflowArtifact,
  type ResearchWorkflowStepDiagnostic,
  type ResearchWorkflowStepId,
  type ResearchWorkflowStepResult,
} from './research-workflow';
import type {
  ResearchWorkflowStepHandler,
  ResearchWorkflowStepHandlerInput,
} from './research-workflow-coordinator';

export interface ResearchWorkflowAnalysisHandlerOptions {
  readonly planProvider: ResearchSynthesisPlanProvider;
  readonly findingService: Pick<
    ResearchFindingService,
    'ensureClaim' | 'ensureFinding'
  >;
  readonly qualityService: Pick<ResearchQualityAssessmentService, 'assessFinding'>;
  readonly qualityStore: ResearchQualitySnapshotRepository;
  readonly opportunityPlanProvider: OpportunityAnalysisPlanProvider;
  readonly opportunityStore: OpportunityStore;
  readonly now?: () => Date;
}

const evidenceSteps = new Set<ResearchWorkflowStepId>([
  'market_understanding',
  'pain_point_research',
  'competitor_research',
  'market_signal_research',
]);

/**
 * Executes an explicit synthesis plan. The provider owns semantic decisions;
 * this handler only validates references, persists aggregates, and runs the
 * deterministic quality service.
 */
export class ResearchWorkflowAnalysisHandler {
  public readonly handler: ResearchWorkflowStepHandler;
  private readonly now: () => Date;

  public constructor(private readonly options: ResearchWorkflowAnalysisHandlerOptions) {
    this.now = options.now ?? (() => new Date());
    this.handler = async (input) => this.execute(input);
  }

  private async execute(
    input: ResearchWorkflowStepHandlerInput,
  ): Promise<ResearchWorkflowStepResult> {
    const stepId = 'opportunity_analysis' as const;
    if (input.isCancelled()) return cancelledResult(stepId);

    const evidence = collectEvidence(input);
    if (evidence.length === 0) {
      return {
        status: 'failed',
        stepId,
        failure: {
          kind: 'precondition_failed',
          message: 'Opportunity analysis requires typed Evidence artifacts from completed search steps.',
          retryable: false,
        },
      };
    }

    const invocationKey = getResearchWorkflowInvocationKey(input.workflow);
    const plan = validateResearchSynthesisPlan(
      await this.options.planProvider.createPlan({
        researchRunId: input.workflow.researchRunId,
        goal: getResearchWorkflowGoal(input.workflow),
        invocationKey,
        evidence,
      }),
      new Set(evidence.map((item) => item.evidenceId)),
    );
    if (input.isCancelled()) return cancelledResult(stepId);

    const createdAt = this.now();
    const persistedClaimIdByDraft = new Map<string, ClaimId>();
    for (const draft of plan.claims) {
      if (input.isCancelled()) return cancelledResult(stepId);
      const claim = await this.options.findingService.ensureClaim({
        id: createSynthesisAggregateId(
          input.workflow.researchRunId,
          invocationKey,
          'claim',
          draft.id,
        ),
        researchRunId: input.workflow.researchRunId,
        text: draft.text,
        evidenceRefs: draft.evidenceIds.map((evidenceId) => ({ evidenceId })),
        createdAt,
      });
      persistedClaimIdByDraft.set(draft.id, claim.id);
    }

    const artifacts: ResearchWorkflowArtifact[] = [];
    const diagnostics: ResearchWorkflowStepDiagnostic[] = [];
    const opportunityFindings: OpportunityAnalysisFindingInput[] = [];
    for (const draft of plan.findings) {
      if (input.isCancelled()) return cancelledResult(stepId);
      const claimIds = draft.claimIds.map((draftId) =>
        requireMappedClaimId(persistedClaimIdByDraft, draftId));
      const finding = await this.options.findingService.ensureFinding({
        id: createSynthesisAggregateId(
          input.workflow.researchRunId,
          invocationKey,
          'finding',
          draft.id,
        ),
        researchRunId: input.workflow.researchRunId,
        type: draft.type,
        title: draft.title,
        description: draft.description,
        claimIds,
        createdAt,
      });
      const assessments = assessmentInputsForFinding(
        plan.assessments,
        draft.claimIds,
        persistedClaimIdByDraft,
      );
      const quality = await this.options.qualityService.assessFinding(
        finding.id,
        assessments,
      );
      if (input.isCancelled()) return cancelledResult(stepId);
      await this.options.qualityStore.ensure(createResearchQualitySnapshot({
        researchRunId: finding.researchRunId,
        findingId: finding.id,
        workflowInvocationKey: invocationKey,
        rulesVersion: RESEARCH_QUALITY_RULES_VERSION,
        assessedAt: this.now(),
        inputs: assessments,
        assessment: quality,
      }));
      artifacts.push(
        { kind: 'finding', findingId: finding.id, claimIds: finding.claimIds },
        qualityArtifact(quality),
      );
      const diagnostic = qualityDiagnostic(quality);
      if (diagnostic !== undefined) diagnostics.push(diagnostic);
      opportunityFindings.push({
        findingId: finding.id,
        type: finding.type,
        title: finding.title,
        description: finding.description,
        claimIds: finding.claimIds,
        evidenceIds: evidenceIdsForFinding(plan.assessments, draft.claimIds),
        qualityStatus: quality.status,
        requiresHumanReview: quality.requiresHumanReview,
      });
    }

    const proposals = await new OpportunityAnalysisService(
      this.options.opportunityPlanProvider,
    ).analyze({
      researchRunId: input.workflow.researchRunId,
      goal: getResearchWorkflowGoal(input.workflow),
      invocationKey,
      findings: opportunityFindings,
    });
    if (input.isCancelled()) return cancelledResult(stepId);

    for (const proposal of proposals) {
      const opportunity = await this.options.opportunityStore.ensure({
        id: createOpportunityAggregateId(
          input.workflow.researchRunId,
          invocationKey,
          proposal.draftId,
        ),
        researchRunId: proposal.researchRunId,
        title: proposal.title,
        targetCustomer: proposal.targetCustomer,
        problem: proposal.problem,
        evidenceIds: proposal.evidenceIds,
        solution: proposal.solution,
        whyNow: proposal.whyNow,
        monetization: proposal.monetization,
        mvp: proposal.mvp,
        score: proposal.score,
        scoreReasoning: proposal.scoreReasoning,
        confidence: proposal.confidence,
      });
      artifacts.push({
        kind: 'opportunity',
        opportunityId: opportunity.id,
        findingIds: proposal.findingIds,
        evidenceIds: opportunity.evidenceIds,
      });
    }

    const artifactIds = artifacts.flatMap((artifact) => {
      if (artifact.kind === 'finding') return [artifact.findingId];
      if (artifact.kind === 'opportunity') return [artifact.opportunityId];
      return [];
    });
    return {
      status: 'completed',
      stepId,
      artifactIds,
      artifacts,
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
    };
  }
}

function evidenceIdsForFinding(
  assessments: readonly { readonly claimId: string; readonly evidenceId: string }[],
  findingClaimDraftIds: readonly string[],
): readonly string[] {
  const included = new Set(findingClaimDraftIds);
  return [...new Set(
    assessments
      .filter((assessment) => included.has(assessment.claimId))
      .map((assessment) => assessment.evidenceId),
  )];
}

function collectEvidence(
  input: ResearchWorkflowStepHandlerInput,
): readonly ResearchSynthesisEvidenceInput[] {
  const collected = new Map<string, ResearchSynthesisEvidenceInput>();
  for (const [stepId, result] of input.completedSteps) {
    if (!evidenceSteps.has(stepId) || result.status !== 'completed') continue;
    for (const artifact of result.artifacts ?? []) {
      if (artifact.kind !== 'evidence' || artifact.stepId !== stepId) continue;
      if (!collected.has(artifact.evidenceId)) {
        collected.set(artifact.evidenceId, {
          evidenceId: artifact.evidenceId,
          stepId: artifact.stepId,
        });
      }
    }
  }
  return [...collected.values()];
}

function assessmentInputsForFinding(
  assessments: readonly {
    readonly claimId: string;
    readonly evidenceId: string;
    readonly relation: ClaimEvidenceAssessmentInput['relation'];
    readonly semanticKind: ClaimEvidenceAssessmentInput['semanticKind'];
    readonly sourceKind: ClaimEvidenceAssessmentInput['sourceKind'];
  }[],
  findingClaimDraftIds: readonly string[],
  persistedClaimIdByDraft: ReadonlyMap<string, ClaimId>,
): readonly ClaimEvidenceAssessmentInput[] {
  const included = new Set(findingClaimDraftIds);
  return assessments
    .filter((assessment) => included.has(assessment.claimId))
    .map((assessment) => ({
      ...assessment,
      claimId: requireMappedClaimId(persistedClaimIdByDraft, assessment.claimId),
    }));
}

function requireMappedClaimId(
  persistedClaimIdByDraft: ReadonlyMap<string, ClaimId>,
  draftId: string,
): ClaimId {
  const claimId = persistedClaimIdByDraft.get(draftId);
  if (claimId === undefined) throw new Error(`Missing persisted Claim for draft ${draftId}`);
  return claimId;
}

function qualityArtifact(
  quality: ResearchQualityAssessment,
): Extract<ResearchWorkflowArtifact, { kind: 'quality_assessment' }> {
  return {
    kind: 'quality_assessment',
    findingId: quality.findingId,
    status: quality.status,
    issueCodes: [...new Set(quality.issues.map((issue) => issue.code))],
    requiresHumanReview: quality.requiresHumanReview,
  };
}

function qualityDiagnostic(
  quality: ResearchQualityAssessment,
): ResearchWorkflowStepDiagnostic | undefined {
  if (quality.status === 'sufficient') return undefined;
  const qualifier = quality.status === 'insufficient'
    ? 'blocks downstream product conclusions'
    : 'requires human review';
  return {
    code: `quality.${quality.status}`,
    message: `Finding ${quality.findingId} quality is ${quality.status} and ${qualifier}.`,
  };
}

function cancelledResult(
  stepId: 'opportunity_analysis',
): ResearchWorkflowStepResult {
  return {
    status: 'failed',
    stepId,
    failure: {
      kind: 'cancelled',
      message: 'Workflow was cancelled before opportunity analysis completed.',
      retryable: false,
    },
  };
}
