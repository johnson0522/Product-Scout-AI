import { describe, expect, it } from 'vitest';
import { validateArgs } from '@deepseek-ai/dsh-tools';

import { apply, submissionParameters } from '../src/dsh/submit-report-tool.mjs';

const valid = {
  title: 'Research report',
  executiveSummary: 'Evidence supports a focused opportunity.',
  sections: [{
    id: 'opportunity',
    title: 'Opportunity',
    content: 'A focused assistant could reduce recurring work.',
    findingIds: ['finding-1'],
    opportunityIds: ['10000000-0000-5000-8000-000000000001'],
  }],
  limitations: ['No pricing interview was conducted.'],
};

describe('product_scout_submit_report schema', () => {
  it('registers the dedicated report submission tool', () => {
    let registered: { readonly name: string } | undefined;
    apply({ tools: { register(tool: { readonly name: string }) { registered = tool; } } });
    expect(registered?.name).toBe('product_scout_submit_report');
  });

  it('accepts the exact report contract and rejects nested extras', () => {
    expect(validateArgs(submissionParameters, valid)).toEqual([]);
    expect(validateArgs(submissionParameters, {
      ...valid,
      sections: [{ ...valid.sections[0], hiddenReasoning: 'not allowed' }],
    })).not.toEqual([]);
    expect(validateArgs(submissionParameters, {
      ...valid,
      sections: [{ ...valid.sections[0], findingIds: [1] }],
    })).not.toEqual([]);
  });
});
