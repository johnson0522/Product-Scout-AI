import type { AgentRuntimeReasoner } from '@product-scout/agent-sdk';
import type {
  ClaimRepository,
  EvidenceAcquisitionRepository,
  EvidenceRepository,
  ResearchFindingRepository,
  ResearchQualitySnapshotRepository,
} from '@product-scout/evidence';
import {
  InMemoryResearchWorkflowCoordinator,
  DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
  RESEARCH_ANALYSIS_WORKFLOW_DEFINITION,
  ResearchFindingService,
  ResearchQualityAssessmentService,
  ResearchWorkflowAnalysisHandler,
  ResearchWorkflowReportHandler,
  ResearchWorkflowSearchHandlers,
  SearchResultEvidenceAcquisitionIngestion,
  type EvidenceIdGenerator,
  type OpportunityStore,
  type ResearchReportStore,
  type ValidationPlanStore,
  type SearchExecutor,
} from '@product-scout/research';

import { ResearchWorkflowRuntimeFactory } from '../runtime/ResearchWorkflowRuntimeFactory';
import {
  createResearchSynthesisRequestId,
  DshResearchSynthesisPlanProvider,
} from '../synthesis/DshResearchSynthesisPlanProvider';
import {
  createOpportunityAnalysisRequestId,
  DshOpportunityAnalysisPlanProvider,
} from '../synthesis/DshOpportunityAnalysisPlanProvider';
import {
  createResearchReportRequestId,
  DshResearchReportPlanProvider,
} from '../synthesis/DshResearchReportPlanProvider';
import {
  createValidationPlanRequestId,
  DshValidationPlanProvider,
} from '../synthesis/DshValidationPlanProvider';

export interface AnalysisWorkflowRuntimeDependencies {
  readonly reasoner: AgentRuntimeReasoner;
  readonly opportunityReasoner: AgentRuntimeReasoner;
  readonly search: SearchExecutor;
  readonly evidenceRepository: EvidenceRepository;
  readonly evidenceAcquisitionRepository: EvidenceAcquisitionRepository;
  readonly claimRepository: ClaimRepository;
  readonly findingRepository: ResearchFindingRepository;
  readonly qualityStore: ResearchQualitySnapshotRepository;
  readonly opportunityStore: OpportunityStore;
  readonly evidenceIdGenerator?: EvidenceIdGenerator;
  readonly now?: () => Date;
  readonly searchLimit?: number;
  readonly workflowTimeoutMs?: number;
}

export interface ResearchWorkflowRuntimeDependencies
  extends AnalysisWorkflowRuntimeDependencies {
  readonly reportReasoner: AgentRuntimeReasoner;
  readonly reportStore: ResearchReportStore;
  readonly validationPlanReasoner: AgentRuntimeReasoner;
  readonly validationPlanStore: ValidationPlanStore;
}

/**
 * Composes the five-step Analysis Workflow from existing application services.
 * Database connections and concrete search/runtime transports remain caller-owned.
 */
export function createAnalysisWorkflowRuntimeFactory(
  dependencies: AnalysisWorkflowRuntimeDependencies,
): ResearchWorkflowRuntimeFactory {
  return createWorkflowRuntimeFactory(dependencies);
}

/** Composes the complete six-step workflow including persisted report generation. */
export function createResearchWorkflowRuntimeFactory(
  dependencies: ResearchWorkflowRuntimeDependencies,
): ResearchWorkflowRuntimeFactory {
  return createWorkflowRuntimeFactory(dependencies, {
    reasoner: dependencies.reportReasoner,
    store: dependencies.reportStore,
    validationPlanReasoner: dependencies.validationPlanReasoner,
    validationPlanStore: dependencies.validationPlanStore,
  });
}

interface ReportRuntimeDependencies {
  readonly reasoner: AgentRuntimeReasoner;
  readonly store: ResearchReportStore;
  readonly validationPlanReasoner: AgentRuntimeReasoner;
  readonly validationPlanStore: ValidationPlanStore;
}

function createWorkflowRuntimeFactory(
  dependencies: AnalysisWorkflowRuntimeDependencies,
  reportDependencies?: ReportRuntimeDependencies,
): ResearchWorkflowRuntimeFactory {
  const planProvider = new DshResearchSynthesisPlanProvider({
    reasoner: dependencies.reasoner,
    evidenceRepository: dependencies.evidenceRepository,
  });
  const findingService = new ResearchFindingService(
    dependencies.evidenceRepository,
    dependencies.evidenceAcquisitionRepository,
    dependencies.claimRepository,
    dependencies.findingRepository,
  );
  const qualityService = new ResearchQualityAssessmentService(findingService);
  const opportunityPlanProvider = new DshOpportunityAnalysisPlanProvider({
    reasoner: dependencies.opportunityReasoner,
  });
  const reportPlanProvider = reportDependencies === undefined
    ? undefined
    : new DshResearchReportPlanProvider({ reasoner: reportDependencies.reasoner });
  const validationPlanProvider = reportDependencies === undefined
    ? undefined
    : new DshValidationPlanProvider({ reasoner: reportDependencies.validationPlanReasoner });
  const ingestion = new SearchResultEvidenceAcquisitionIngestion(
    dependencies.evidenceAcquisitionRepository,
    {
      ...(dependencies.evidenceIdGenerator === undefined
        ? {}
        : { idGenerator: dependencies.evidenceIdGenerator }),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    },
  );

  return new ResearchWorkflowRuntimeFactory({
    ...(dependencies.workflowTimeoutMs === undefined
      ? {}
      : { workflowTimeoutMs: dependencies.workflowTimeoutMs }),
    metadata: {
      runtime: 'research-workflow',
      workflow: reportDependencies === undefined
        ? RESEARCH_ANALYSIS_WORKFLOW_DEFINITION.id
        : DEFAULT_RESEARCH_WORKFLOW_DEFINITION.id,
      reasoner: 'agent-runtime-reasoner',
    },
    createCoordinator: () => {
      const analysis = new ResearchWorkflowAnalysisHandler({
        planProvider,
        findingService,
        qualityService,
        qualityStore: dependencies.qualityStore,
        opportunityPlanProvider,
        opportunityStore: dependencies.opportunityStore,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      });
      const report = reportPlanProvider === undefined
        || validationPlanProvider === undefined
        || reportDependencies === undefined
        ? undefined
        : new ResearchWorkflowReportHandler({
          planProvider: reportPlanProvider,
          reportStore: reportDependencies.store,
          findingRepository: dependencies.findingRepository,
          opportunityStore: dependencies.opportunityStore,
          validationPlanProvider,
          validationPlanStore: reportDependencies.validationPlanStore,
          ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        });
      const searchHandlers = new ResearchWorkflowSearchHandlers({
        search: dependencies.search,
        ingestion,
        analysisHandler: analysis.handler,
        ...(report === undefined ? {} : { reportHandler: report.handler }),
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        ...(dependencies.searchLimit === undefined ? {} : { limit: dependencies.searchLimit }),
      });
      return new InMemoryResearchWorkflowCoordinator({
        definition: reportDependencies === undefined
          ? RESEARCH_ANALYSIS_WORKFLOW_DEFINITION
          : DEFAULT_RESEARCH_WORKFLOW_DEFINITION,
        handlers: searchHandlers.handlers,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      });
    },
    cancelActiveReasoning: async (researchRunId, workflowInvocationKey) => {
      await Promise.all([
        dependencies.reasoner.cancel(
          createResearchSynthesisRequestId(researchRunId, workflowInvocationKey),
        ),
        dependencies.opportunityReasoner.cancel(
          createOpportunityAnalysisRequestId(researchRunId, workflowInvocationKey),
        ),
        ...(reportDependencies === undefined ? [] : [
          reportDependencies.reasoner.cancel(
            createResearchReportRequestId(researchRunId, workflowInvocationKey),
          ),
          reportDependencies.validationPlanReasoner.cancel(
            createValidationPlanRequestId(researchRunId, workflowInvocationKey),
          ),
        ]),
      ]);
    },
  });
}
