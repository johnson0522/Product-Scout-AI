import { defineTool } from '@deepseek-ai/dsh-tools';

const stringArray = {
  type: 'array',
  items: { type: 'string' },
};

export const submissionParameters = {
  claims: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        text: { type: 'string', required: true },
        evidenceIds: { ...stringArray, required: true },
      },
    },
  },
  findings: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        type: { type: 'string', enum: ['opportunity', 'risk', 'insight'], required: true },
        title: { type: 'string', required: true },
        description: { type: 'string', required: true },
        claimIds: { ...stringArray, required: true },
      },
    },
  },
  assessments: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claimId: { type: 'string', required: true },
        evidenceId: { type: 'string', required: true },
        relation: {
          type: 'string',
          enum: ['supports', 'contradicts', 'unclear'],
          required: true,
        },
        semanticKind: {
          type: 'string',
          enum: ['verifiable_fact', 'user_report', 'analysis', 'recommendation', 'unknown'],
          required: true,
        },
        sourceKind: {
          type: 'string',
          enum: [
            'primary_research',
            'first_party',
            'community',
            'independent_third_party',
            'other',
            'unknown',
          ],
          required: true,
        },
      },
    },
  },
};

export const name = 'product-scout-submit-synthesis-tool';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'product_scout_submit_synthesis',
    description: 'Submit the complete Product Scout research synthesis plan exactly once.',
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
