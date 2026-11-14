import { describe, expect, it } from 'vitest';
import { validateArgs } from '@deepseek-ai/dsh-tools';

import { apply, submissionParameters } from '../src/dsh/submit-synthesis-tool.mjs';

describe('product_scout_submit_synthesis schema', () => {
  it('registers the expected submission tool through the Cordis plugin boundary', () => {
    let registered: { readonly name: string } | undefined;
    apply({ tools: { register(tool: { readonly name: string }) { registered = tool; } } });

    expect(registered?.name).toBe('product_scout_submit_synthesis');
  });

  it('accepts the complete contract and rejects invalid nested values', () => {
    const valid = {
      claims: [{ id: 'c1', text: 'Claim', evidenceIds: ['e1'] }],
      findings: [{
        id: 'f1',
        type: 'insight',
        title: 'Finding',
        description: 'Description',
        claimIds: ['c1'],
      }],
      assessments: [{
        claimId: 'c1',
        evidenceId: 'e1',
        relation: 'supports',
        semanticKind: 'user_report',
        sourceKind: 'community',
      }],
    };
    expect(validateArgs(submissionParameters, valid)).toEqual([]);
    expect(validateArgs(submissionParameters, {
      ...valid,
      findings: [{ ...valid.findings[0], type: 'prediction' }],
    })).not.toEqual([]);
    expect(validateArgs(submissionParameters, {
      ...valid,
      claims: [{ ...valid.claims[0], extra: true }],
    })).not.toEqual([]);
  });
});
