import { defineTool } from '@deepseek-ai/dsh-tools';

const stringArray = { type: 'array', items: { type: 'string' } };

export const submissionParameters = {
  title: { type: 'string', required: true },
  executiveSummary: { type: 'string', required: true },
  sections: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        title: { type: 'string', required: true },
        content: { type: 'string', required: true },
        findingIds: { ...stringArray, required: true },
        opportunityIds: { ...stringArray, required: true },
      },
    },
  },
  limitations: { ...stringArray, required: true },
};

export const name = 'product-scout-submit-report-tool';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'product_scout_submit_report',
    description: 'Submit the complete evidence-backed Product Scout research report exactly once.',
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
