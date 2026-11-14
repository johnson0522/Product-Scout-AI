import { describe, expect, it } from 'vitest';
import { validateArgs } from '@deepseek-ai/dsh-tools';

import { apply, submissionParameters } from '../src/dsh/submit-opportunities-tool.mjs';

const valid = {
  opportunities: [{
    id: 'opportunity-1',
    findingIds: ['finding-1'],
    title: 'Reconciliation assistant',
    targetCustomer: 'Operations teams',
    problem: 'Recurring reconciliation work',
    solution: 'Assisted workflow',
    whyNow: 'Operational complexity is increasing',
    monetization: 'Subscription',
    mvp: 'Import, reconcile, export',
    confidence: 80,
    scoreFactors: {
      pain: factor('pain'),
      willingnessToPay: factor('willingness'),
      frequency: factor('frequency'),
      market: factor('market'),
      competition: factor('competition'),
      acquisition: factor('acquisition'),
      feasibility: factor('feasibility'),
    },
  }],
};

describe('product_scout_submit_opportunities schema', () => {
  it('registers the dedicated Cordis submission tool', () => {
    let registered: { readonly name: string } | undefined;
    apply({ tools: { register(tool: { readonly name: string }) { registered = tool; } } });
    expect(registered?.name).toBe('product_scout_submit_opportunities');
  });

  it('accepts the exact nested contract and rejects missing or extra fields', () => {
    expect(validateArgs(submissionParameters, valid)).toEqual([]);
    expect(validateArgs(submissionParameters, {
      opportunities: [{ ...valid.opportunities[0], extra: true }],
    })).not.toEqual([]);
    expect(validateArgs(submissionParameters, {
      opportunities: [{
        ...valid.opportunities[0],
        scoreFactors: { ...valid.opportunities[0]!.scoreFactors, pain: { value: 80 } },
      }],
    })).not.toEqual([]);
  });
});

function factor(reasoning: string) {
  return { value: 75, reasoning };
}
