import { describe, expect, it } from 'vitest';
import { validateArgs } from '@deepseek-ai/dsh-tools';

import {
  apply,
  submissionParameters,
} from '../src/dsh/submit-validation-plan-tool.mjs';

const valid = {
  days: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    objective: `Validate assumption ${day}`,
    activities: [`Run activity ${day}`],
    successCriteria: [`Meet criterion ${day}`],
  })),
};

describe('product_scout_submit_validation_plan schema', () => {
  it('registers the dedicated validation plan Tool', () => {
    let registered: { readonly name: string } | undefined;
    apply({ tools: { register(tool: { readonly name: string }) { registered = tool; } } });
    expect(registered?.name).toBe('product_scout_submit_validation_plan');
  });

  it('accepts the exact nested structure and rejects extras or wrong types', () => {
    expect(validateArgs(submissionParameters, valid)).toEqual([]);
    expect(validateArgs(submissionParameters, {
      days: [{ ...valid.days[0], hiddenReasoning: 'not allowed' }],
    })).not.toEqual([]);
    expect(validateArgs(submissionParameters, {
      days: [{ ...valid.days[0], activities: [1] }],
    })).not.toEqual([]);
  });
});
