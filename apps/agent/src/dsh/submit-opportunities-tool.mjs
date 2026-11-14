import { defineTool } from '@deepseek-ai/dsh-tools';

const scoreFactor = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: 'number', required: true },
    reasoning: { type: 'string', required: true },
  },
};

export const submissionParameters = {
  opportunities: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        findingIds: {
          type: 'array',
          items: { type: 'string' },
          required: true,
        },
        title: { type: 'string', required: true },
        targetCustomer: { type: 'string', required: true },
        problem: { type: 'string', required: true },
        solution: { type: 'string', required: true },
        whyNow: { type: 'string', required: true },
        monetization: { type: 'string', required: true },
        mvp: { type: 'string', required: true },
        confidence: { type: 'number', required: true },
        scoreFactors: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            pain: { ...scoreFactor, required: true },
            willingnessToPay: { ...scoreFactor, required: true },
            frequency: { ...scoreFactor, required: true },
            market: { ...scoreFactor, required: true },
            competition: { ...scoreFactor, required: true },
            acquisition: { ...scoreFactor, required: true },
            feasibility: { ...scoreFactor, required: true },
          },
        },
      },
    },
  },
};

export const name = 'product-scout-submit-opportunities-tool';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'product_scout_submit_opportunities',
    description: 'Submit the complete Product Scout opportunity analysis exactly once.',
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
