import { describe, expect, it } from 'vitest';

import {
  calculateOpportunityScore,
  OPPORTUNITY_SCORE_WEIGHTS,
  type OpportunityScoreInput,
} from '../src';

const perfectInput: OpportunityScoreInput = {
  pain: 100,
  willingnessToPay: 100,
  frequency: 100,
  market: 100,
  competition: 100,
  acquisition: 100,
  feasibility: 100,
};

describe('calculateOpportunityScore', () => {
  it('returns a reproducible weighted score from 0 to 100', () => {
    const result = calculateOpportunityScore(perfectInput);

    expect(result.total).toBe(100);
    expect(result.breakdown.pain).toEqual({
      value: 100,
      weight: OPPORTUNITY_SCORE_WEIGHTS.pain,
      contribution: 20,
    });
  });

  it('applies each dimension weight explicitly', () => {
    const result = calculateOpportunityScore({
      ...perfectInput,
      pain: 50,
      willingnessToPay: 0,
      frequency: 0,
      market: 0,
      competition: 0,
      acquisition: 0,
      feasibility: 0,
    });

    expect(result.total).toBe(10);
  });

  it.each([
    ['negative', -1],
    ['over 100', 101],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s score values', (_label, invalidValue) => {
    expect(() =>
      calculateOpportunityScore({ ...perfectInput, pain: invalidValue }),
    ).toThrow(RangeError);
  });
});
