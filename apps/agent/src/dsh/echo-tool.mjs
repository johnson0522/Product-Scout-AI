import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'product-scout-echo-tool';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'product_scout_echo',
    description: 'Return the supplied value in a deterministic structured object.',
    parameters: {
      value: { type: 'string', required: true, description: 'Value to echo' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          echoed: { type: 'string', required: true },
          source: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return { echoed: args.value, source: 'product_scout_echo' };
    },
  }));
}
