import { describe, expect, it } from 'vitest';

import {
  FakeOpportunityAnalysisPlanProvider,
  InvalidOpportunityAnalysisPlanError,
  createOpportunityAggregateId,
  parseOpportunityAnalysisPlan,
  OpportunityAnalysisService,
  scoreOpportunityAnalysisPlan,
  type OpportunityAnalysisPlan,
  type OpportunityAnalysisPlanInput,
} from '../src';

const input: OpportunityAnalysisPlanInput = {
  researchRunId: 'run-1',
  goal: 'Reduce recurring operations work',
  invocationKey: 'invocation-1',
  findings: [
    {
      findingId: 'finding-1',
      type: 'opportunity',
      title: 'Recurring reconciliation burden',
      description: 'Teams repeatedly reconcile records by hand.',
      claimIds: ['claim-1'],
      evidenceIds: ['evidence-1', 'evidence-2'],
      qualityStatus: 'sufficient',
      requiresHumanReview: false,
    },
    {
      findingId: 'finding-review',
      type: 'risk',
      title: 'Unresolved conflict',
      description: 'Sources disagree about willingness to pay.',
      claimIds: ['claim-2'],
      evidenceIds: ['evidence-3'],
      qualityStatus: 'conflicted',
      requiresHumanReview: true,
    },
  ],
};

const plan: OpportunityAnalysisPlan = {
  opportunities: [{
    id: 'reconciliation-assistant',
    findingIds: ['finding-1'],
    title: 'Reconciliation assistant',
    targetCustomer: 'Small operations teams',
    problem: 'Recurring reconciliation consumes staff time.',
    solution: 'A guided reconciliation workspace with exception review.',
    whyNow: 'Modern APIs expose the required operational records.',
    monetization: 'Subscription priced per operations team.',
    mvp: 'Import two record sets, detect differences, and review exceptions.',
    confidence: 78,
    scoreFactors: {
      pain: factor(90, 'Two independent sources describe recurring manual work.'),
      willingnessToPay: factor(60, 'Evidence shows operational cost but limited direct pricing proof.'),
      frequency: factor(85, 'The workflow is described as recurring.'),
      market: factor(70, 'The affected segment is broad enough for focused validation.'),
      competition: factor(55, 'Alternatives exist but leave workflow gaps.'),
      acquisition: factor(65, 'The target role is reachable through focused communities.'),
      feasibility: factor(80, 'The MVP uses common import and comparison capabilities.'),
    },
  }],
};

describe('parseOpportunityAnalysisPlan', () => {
  it('parses the complete unknown contract and rejects model-supplied extra fields', () => {
    expect(parseOpportunityAnalysisPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(() => parseOpportunityAnalysisPlan({
      opportunities: [{ ...plan.opportunities[0]!, total: 100 }],
    })).toThrow('unknown field: total');
  });

  it('rejects incomplete score factors and malformed nested values', () => {
    const { feasibility: _removed, ...incomplete } = plan.opportunities[0]!.scoreFactors;
    expect(() => parseOpportunityAnalysisPlan({
      opportunities: [{ ...plan.opportunities[0]!, scoreFactors: incomplete }],
    })).toThrow('missing required field: feasibility');
    expect(() => parseOpportunityAnalysisPlan({
      opportunities: [{
        ...plan.opportunities[0]!,
        scoreFactors: {
          ...plan.opportunities[0]!.scoreFactors,
          pain: { value: 'high', reasoning: 'reason' },
        },
      }],
    })).toThrow('pain.value must be a number');
  });

  it('accepts an explicit empty result instead of requiring fabricated opportunities', () => {
    expect(parseOpportunityAnalysisPlan({ opportunities: [] })).toEqual({ opportunities: [] });
    expect(scoreOpportunityAnalysisPlan({ opportunities: [] }, input)).toEqual([]);
  });
});

describe('scoreOpportunityAnalysisPlan', () => {
  it('derives Evidence from sufficient Findings and calculates a reproducible weighted score', () => {
    const first = scoreOpportunityAnalysisPlan(plan, input);
    const second = scoreOpportunityAnalysisPlan(plan, input);

    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      draftId: 'reconciliation-assistant',
      researchRunId: 'run-1',
      findingIds: ['finding-1'],
      evidenceIds: ['evidence-1', 'evidence-2'],
      score: { total: 73.25 },
    });
    expect(first[0]?.scoreReasoning.pain).toContain('independent sources');
  });

  it('rejects unknown, duplicate, and quality-blocked Finding references', () => {
    expect(() => scoreOpportunityAnalysisPlan(withFindingIds(['missing']), input))
      .toThrow('unknown Finding');
    expect(() => scoreOpportunityAnalysisPlan(withFindingIds(['finding-1', 'finding-1']), input))
      .toThrow('must not contain duplicates');
    expect(() => scoreOpportunityAnalysisPlan(withFindingIds(['finding-review']), input))
      .toThrow('without sufficient quality');
  });

  it('rejects illegal scores, empty explanations, and duplicate draft ids', () => {
    expect(() => scoreOpportunityAnalysisPlan({
      opportunities: [{
        ...plan.opportunities[0]!,
        scoreFactors: {
          ...plan.opportunities[0]!.scoreFactors,
          pain: factor(101, 'invalid'),
        },
      }],
    }, input)).toThrow('pain score must be between 0 and 100');

    expect(() => scoreOpportunityAnalysisPlan({
      opportunities: [{
        ...plan.opportunities[0]!,
        scoreFactors: {
          ...plan.opportunities[0]!.scoreFactors,
          pain: factor(80, '  '),
        },
      }],
    }, input)).toThrow('pain reasoning must be a non-empty string');

    expect(() => scoreOpportunityAnalysisPlan({
      opportunities: [plan.opportunities[0]!, plan.opportunities[0]!],
    }, input)).toThrow(InvalidOpportunityAnalysisPlanError);
  });
});

describe('OpportunityAnalysisService', () => {
  it('calls the injected provider and returns deterministically scored proposals', async () => {
    const provider = new FakeOpportunityAnalysisPlanProvider({ plan });
    const service = new OpportunityAnalysisService(provider);

    const proposals = await service.analyze(input);

    expect(provider.calls).toEqual([input]);
    expect(proposals[0]?.score.total).toBe(73.25);
  });

  it('propagates provider failures without replacing them', async () => {
    const failure = new Error('provider failed');
    const service = new OpportunityAnalysisService(
      new FakeOpportunityAnalysisPlanProvider({ error: failure }),
    );

    await expect(service.analyze(input)).rejects.toBe(failure);
  });
});

describe('createOpportunityAggregateId', () => {
  it('is a stable UUID scoped by run, invocation, and draft identity', () => {
    const first = createOpportunityAggregateId('run-1', 'invocation-1', 'draft-1');
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(createOpportunityAggregateId('run-1', 'invocation-1', 'draft-1')).toBe(first);
    expect(createOpportunityAggregateId('run-1', 'invocation-2', 'draft-1')).not.toBe(first);
    expect(createOpportunityAggregateId('run-2', 'invocation-1', 'draft-1')).not.toBe(first);
    expect(createOpportunityAggregateId('run-1', 'invocation-1', 'draft-2')).not.toBe(first);
  });
});

function factor(value: number, reasoning: string) {
  return { value, reasoning };
}

function withFindingIds(findingIds: readonly string[]): OpportunityAnalysisPlan {
  return {
    opportunities: [{ ...plan.opportunities[0]!, findingIds }],
  };
}
