import { defineTool } from '@deepseek-ai/dsh-tools';

const stringArray = { type: 'array', items: { type: 'string' } };

export const submissionParameters = {
  days: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        day: { type: 'number', required: true },
        objective: { type: 'string', required: true },
        activities: { ...stringArray, required: true },
        successCriteria: { ...stringArray, required: true },
      },
    },
  },
};

export const name = 'product-scout-submit-validation-plan-tool';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'product_scout_submit_validation_plan',
    description: 'Submit the complete seven-day Product Scout validation plan exactly once.',
    parameters: submissionParameters,
    output: {
      schema: {
        type: 'object',
        properties: { accepted: { type: 'boolean', required: true } },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      return { accepted: true };
    },
  }));
}
