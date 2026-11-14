import { describe, expect, it } from 'vitest';

import {
  createSynthesisAggregateId,
  InvalidResearchSynthesisPlanError,
  parseResearchSynthesisPlan,
  validateResearchSynthesisPlan,
  type ResearchSynthesisPlan,
} from '../src';

const plan: ResearchSynthesisPlan = {
  claims: [{
    id: 'recurring-work',
    text: 'Teams report recurring manual reconciliation work.',
    evidenceIds: ['evidence-1', 'evidence-2'],
  }],
  findings: [{
    id: 'workflow-burden',
    type: 'insight',
    title: 'Recurring workflow burden',
    description: 'Two sources describe recurring manual reconciliation.',
    claimIds: ['recurring-work'],
  }],
  assessments: [
    assessment('evidence-1'),
    assessment('evidence-2'),
  ],
};

describe('validateResearchSynthesisPlan', () => {
  it('accepts explicit, traceable Claim, Finding, and assessment drafts', () => {
    expect(validateResearchSynthesisPlan(
      plan,
      new Set(['evidence-1', 'evidence-2']),
    )).toEqual(plan);
  });

  it('rejects Evidence outside completed workflow artifacts', () => {
    expect(() => validateResearchSynthesisPlan(plan, new Set(['evidence-1'])))
      .toThrow('outside the completed workflow');
  });

  it('rejects duplicate local ids, unknown Claim references, and duplicate assessments', () => {
    expect(() => validateResearchSynthesisPlan({
      ...plan,
      claims: [...plan.claims, plan.claims[0]!],
    }, new Set(['evidence-1', 'evidence-2'])))
      .toThrow(InvalidResearchSynthesisPlanError);

    expect(() => validateResearchSynthesisPlan({
      ...plan,
      findings: [{ ...plan.findings[0]!, claimIds: ['missing'] }],
    }, new Set(['evidence-1', 'evidence-2'])))
      .toThrow('unknown Claim draft');

    expect(() => validateResearchSynthesisPlan({
      ...plan,
      assessments: [...plan.assessments, plan.assessments[0]!],
    }, new Set(['evidence-1', 'evidence-2'])))
      .toThrow('Duplicate assessment');
  });

  it('requires an explicit relationship and classification for every Claim/Evidence pair', () => {
    expect(() => validateResearchSynthesisPlan({
      ...plan,
      assessments: [plan.assessments[0]!],
    }, new Set(['evidence-1', 'evidence-2'])))
      .toThrow('Missing explicit assessment');
  });
});

describe('parseResearchSynthesisPlan', () => {
  it('parses the complete structured contract from unknown input', () => {
    expect(parseResearchSynthesisPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it('rejects missing, unknown, and incorrectly typed fields', () => {
    expect(() => parseResearchSynthesisPlan({ claims: [], findings: [] }))
      .toThrow('missing required field: assessments');
    expect(() => parseResearchSynthesisPlan({ ...plan, prose: 'ignore the contract' }))
      .toThrow('unknown field: prose');
    expect(() => parseResearchSynthesisPlan({
      ...plan,
      claims: [{ ...plan.claims[0]!, evidenceIds: 'evidence-1' }],
    })).toThrow('evidenceIds must be an array');
  });

  it('rejects invalid finite enum values and unknown nested fields', () => {
    expect(() => parseResearchSynthesisPlan({
      ...plan,
      findings: [{ ...plan.findings[0]!, type: 'prediction' }],
    })).toThrow('findings[0].type is invalid');
    expect(() => parseResearchSynthesisPlan({
      ...plan,
      assessments: [{ ...plan.assessments[0]!, confidence: 100 }],
    })).toThrow('unknown field: confidence');
  });
});

describe('createSynthesisAggregateId', () => {
  it('is stable for one invocation and separates invocation, aggregate, and draft identity', () => {
    const first = createSynthesisAggregateId('run-1', 'invocation-1', 'claim', 'claim-a');
    expect(createSynthesisAggregateId('run-1', 'invocation-1', 'claim', 'claim-a'))
      .toBe(first);
    expect(createSynthesisAggregateId('run-2', 'invocation-1', 'claim', 'claim-a'))
      .not.toBe(first);
    expect(createSynthesisAggregateId('run-1', 'invocation-2', 'claim', 'claim-a'))
      .not.toBe(first);
    expect(createSynthesisAggregateId('run-1', 'invocation-1', 'finding', 'claim-a'))
      .not.toBe(first);
    expect(createSynthesisAggregateId('run-1', 'invocation-1', 'claim', 'claim-b'))
      .not.toBe(first);
  });
});

function assessment(evidenceId: string) {
  return {
    claimId: 'recurring-work',
    evidenceId,
    relation: 'supports' as const,
    semanticKind: 'user_report' as const,
    sourceKind: 'independent_third_party' as const,
  };
}
