import type { AgentRuntimeReasoner } from '@product-scout/agent-sdk';
import type { Evidence, EvidenceRepository } from '@product-scout/evidence';
import {
  parseResearchSynthesisPlan,
  type ResearchSynthesisPlan,
  type ResearchSynthesisPlanInput,
  type ResearchSynthesisPlanProvider,
} from '@product-scout/research';

import {
  buildResearchSynthesisPrompt,
  DEFAULT_SYNTHESIS_PROMPT_LIMITS,
  RESEARCH_SYNTHESIS_CONTRACT,
  type SynthesisPromptLimits,
} from './prompt';

export class SynthesisEvidenceNotFoundError extends Error {
  public constructor(evidenceId: string) {
    super(`Synthesis Evidence not found: ${evidenceId}`);
    this.name = 'SynthesisEvidenceNotFoundError';
  }
}

export class SynthesisContractMismatchError extends Error {
  public constructor(expected: string, actual: string) {
    super(`Reasoner output contract mismatch: expected ${expected}, received ${actual}`);
    this.name = 'SynthesisContractMismatchError';
  }
}

export interface DshResearchSynthesisPlanProviderOptions {
  readonly reasoner: AgentRuntimeReasoner;
  readonly evidenceRepository: Pick<EvidenceRepository, 'getById'>;
  readonly limits?: SynthesisPromptLimits;
}

export function createResearchSynthesisRequestId(
  researchRunId: string,
  workflowInvocationKey: string,
): string {
  return `${researchRunId}:${workflowInvocationKey}:synthesis`;
}

/** Bridges application synthesis to a runtime-neutral structured reasoner. */
export class DshResearchSynthesisPlanProvider implements ResearchSynthesisPlanProvider {
  public constructor(private readonly options: DshResearchSynthesisPlanProviderOptions) {}

  public async createPlan(input: ResearchSynthesisPlanInput): Promise<ResearchSynthesisPlan> {
    const evidence = await this.loadEvidence(input);
    const requestId = createResearchSynthesisRequestId(
      input.researchRunId,
      input.invocationKey,
    );
    const result = await this.options.reasoner.reason({
      requestId,
      outputContract: RESEARCH_SYNTHESIS_CONTRACT,
      prompt: buildResearchSynthesisPrompt(
        input.goal,
        evidence,
        this.options.limits ?? DEFAULT_SYNTHESIS_PROMPT_LIMITS,
      ),
    });
    if (result.requestId !== requestId) {
      throw new Error(`Reasoner request id mismatch: expected ${requestId}, received ${result.requestId}`);
    }
    if (result.outputContract !== RESEARCH_SYNTHESIS_CONTRACT) {
      throw new SynthesisContractMismatchError(
        RESEARCH_SYNTHESIS_CONTRACT,
        result.outputContract,
      );
    }
    return parseResearchSynthesisPlan(result.output);
  }

  private async loadEvidence(
    input: ResearchSynthesisPlanInput,
  ): Promise<readonly { readonly evidence: Evidence; readonly stepId: ResearchSynthesisPlanInput['evidence'][number]['stepId'] }[]> {
    const loaded = [];
    for (const reference of input.evidence) {
      const evidence = await this.options.evidenceRepository.getById(reference.evidenceId);
      if (evidence === null) throw new SynthesisEvidenceNotFoundError(reference.evidenceId);
      loaded.push({ evidence, stepId: reference.stepId });
    }
    return loaded;
  }
}
